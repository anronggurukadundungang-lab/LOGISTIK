import type { DatabaseSync } from "node:sqlite";
import { getDb, nowIso, withTx } from "../db.ts";
import { validate } from "../lib/http.ts";
import { ApiError, ValidationError } from "../lib/http.ts";
import { notify, writeAudit, type AuthUser } from "../lib/auth.ts";
import { roundQty } from "../lib/utils.ts";
import {
  findApproverIds,
  getBalance,
  postEntryTx,
  reverseEntryTx,
  unitCode,
} from "./stock.ts";

export type ApprovalType =
  | "ADJUSTMENT"
  | "OPNAME"
  | "DAMAGE"
  | "LOSS"
  | "EXPIRED"
  | "CORRECTION";

export interface ApprovalRow {
  id: number;
  type: ApprovalType;
  department_id: number;
  item_id: number | null;
  requested_by: number;
  status: string;
  reason: string;
  payload_json: string;
  summary: string | null;
  created_at: string;
}

export function createApprovalTx(
  tx: DatabaseSync,
  user: AuthUser,
  input: {
    type: ApprovalType;
    departmentId: number;
    itemId?: number | null;
    reason: string;
    summary: string;
    payload: Record<string, unknown>;
  },
): number {
  const now = nowIso();
  const result = tx
    .prepare(
      `INSERT INTO approval_requests
        (type, department_id, item_id, requested_by, status, reason, payload_json, summary, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?)`,
    )
    .run(
      input.type,
      input.departmentId,
      input.itemId ?? null,
      user.id,
      input.reason,
      JSON.stringify(input.payload),
      input.summary,
      now,
      now,
    );
  const approvalId = Number(result.lastInsertRowid);
  writeAudit(tx, {
    actor: user,
    action: "CREATE_APPROVAL_REQUEST",
    entityType: "approval_requests",
    entityId: approvalId,
    after: {
      type: input.type,
      departmentId: input.departmentId,
      summary: input.summary,
      reason: input.reason,
    },
  });
  const approvers = findApproverIds(tx, input.departmentId, user.id);
  notify(
    tx,
    approvers,
    "Pengajuan menunggu persetujuan",
    `${input.summary} diajukan oleh ${user.name}.`,
    "/approvals",
  );
  return approvalId;
}

export function createApprovalRequest(
  user: AuthUser,
  input: {
    type: ApprovalType;
    departmentId: number;
    itemId?: number | null;
    reason: string;
    summary: string;
    payload: Record<string, unknown>;
  },
) {
  return withTx((tx) => {
    const id = createApprovalTx(tx, user, input);
    return tx.prepare("SELECT * FROM approval_requests WHERE id = ?").get(id);
  });
}

interface ApprovalDetail {
  id: number;
  type: ApprovalType;
  department_id: number;
  item_id: number | null;
  requested_by: number;
  status: string;
  reason: string;
  payload_json: string;
  summary: string | null;
  source_identity: string | null;
}

export function decideApproval(
  user: AuthUser,
  approvalId: number,
  decision: "APPROVED" | "REJECTED",
  note: string | null,
  meta: { ip?: string; userAgent?: string },
) {
  return withTx((tx) => {
    const approval = tx
      .prepare(
        `SELECT a.*, u.name AS requester_name, d.name AS department_name
           FROM approval_requests a
           JOIN users u ON u.id = a.requested_by
           JOIN departments d ON d.id = a.department_id
          WHERE a.id = ?`,
      )
      .get(approvalId) as
      | (ApprovalDetail & { requester_name: string; department_name: string })
      | undefined;
    if (!approval) throw new ValidationError("Pengajuan tidak ditemukan.");
    if (approval.status !== "PENDING")
      throw new ValidationError("Pengajuan ini sudah diputuskan.");
    if (approval.requested_by === user.id) {
      throw new ApiError(
        403,
        "Anda tidak dapat menyetujui pengajuan yang Anda buat sendiri.",
      );
    }

    const payload = JSON.parse(approval.payload_json) as Record<
      string,
      unknown
    >;
    let resultingEntryId: number | null = null;

    if (decision === "APPROVED") {
      switch (approval.type) {
        case "ADJUSTMENT": {
          const entry = postEntryTx(tx, {
            departmentId: approval.department_id,
            itemId: Number(payload.itemId),
            entryType: "ADJUSTMENT",
            qtyDelta: Number(payload.qtyDelta),
            occurredAt: String(payload.occurredAt),
            sourceType: "APPROVAL",
            sourceId: approval.id,
            description: String(
              payload.description ?? "Penyesuaian stok disetujui",
            ),
            reason: approval.reason,
            createdBy: user.id,
          });
          tx.prepare(
            "INSERT INTO stock_adjustments (entry_id, reason, approval_id, created_at) VALUES (?, ?, ?, ?)",
          ).run(entry.id, approval.reason, approval.id, nowIso());
          resultingEntryId = entry.id;
          break;
        }
        case "DAMAGE":
        case "LOSS":
        case "EXPIRED": {
          const qty = Number(payload.qty);
          const entry = postEntryTx(tx, {
            departmentId: approval.department_id,
            itemId: Number(payload.itemId),
            entryType: approval.type,
            qtyDelta: -Math.abs(qty),
            occurredAt: String(payload.occurredAt),
            sourceType: "APPROVAL",
            sourceId: approval.id,
            description: String(
              payload.notes ?? approval.summary ?? "Barang rusak/hilang",
            ),
            reason: approval.reason,
            createdBy: user.id,
          });
          tx.prepare(
            "INSERT INTO stock_damages (entry_id, kind, notes, created_at) VALUES (?, ?, ?, ?)",
          ).run(entry.id, approval.type, String(payload.notes ?? ""), nowIso());
          resultingEntryId = entry.id;
          break;
        }
        case "CORRECTION": {
          const entryId = Number(payload.entryId);
          const newQty = Number(payload.newQty);
          const original = tx
            .prepare(
              `SELECT e.*, c.id AS consumption_id, c.activity_category, c.officer_name
                 FROM stock_entries e LEFT JOIN stock_consumptions c ON c.entry_id = e.id
                WHERE e.id = ?`,
            )
            .get(entryId) as
            | {
                id: number;
                entry_type: string;
                department_id: number;
                item_id: number;
                occurred_at: string;
              }
            | undefined;
          if (!original)
            throw new ValidationError(
              "Transaksi pemakaian yang dikoreksi tidak ditemukan.",
            );
          if (original.entry_type !== "CONSUMPTION") {
            throw new ValidationError(
              "Koreksi hanya berlaku untuk transaksi pemakaian.",
            );
          }
          if (original.department_id !== approval.department_id) {
            throw new ValidationError(
              "Transaksi berada di bagian yang berbeda.",
            );
          }
          const reversal = reverseEntryTx(
            tx,
            entryId,
            user.id,
            approval.reason,
          );
          let newEntryId: number | null = null;
          if (newQty > 0) {
            const newEntry = postEntryTx(tx, {
              departmentId: approval.department_id,
              itemId: original.item_id,
              entryType: "CONSUMPTION",
              qtyDelta: -newQty,
              occurredAt: original.occurred_at,
              sourceType: "CORRECTION",
              sourceId: entryId,
              description: `Pemakaian pengganti untuk ${String(payload.originalEntryNo ?? entryId)}`,
              reason: approval.reason,
              createdBy: user.id,
            });
            tx.prepare(
              `INSERT INTO stock_consumptions
                (entry_id, activity_category, officer_name, notes, is_correction, correction_of_entry_id, created_at)
               VALUES (?, ?, ?, ?, 1, ?, ?)`,
            ).run(
              newEntry.id,
              (payload.activityCategory as string | null) ?? null,
              (payload.officerName as string | null) ?? null,
              `Koreksi: ${approval.reason}`,
              entryId,
              nowIso(),
            );
            newEntryId = newEntry.id;
          }
          resultingEntryId = newEntryId ?? reversal.id;
          break;
        }
        case "OPNAME": {
          resultingEntryId = applyOpnameApprovalTx(tx, approval, user);
          break;
        }
        default:
          throw new ValidationError("Jenis pengajuan tidak dikenal.");
      }
    }

    const now = nowIso();
    tx.prepare(
      `UPDATE approval_requests
          SET status = ?, decided_by = ?, decided_at = ?, decision_note = ?, resulting_entry_id = ?, updated_at = ?
        WHERE id = ?`,
    ).run(decision, user.id, now, note, resultingEntryId, now, approval.id);

    writeAudit(tx, {
      actor: user,
      action: decision === "APPROVED" ? "APPROVE_REQUEST" : "REJECT_REQUEST",
      entityType: "approval_requests",
      entityId: approval.id,
      before: { status: approval.status },
      after: {
        status: decision,
        type: approval.type,
        department: approval.department_name,
        resultingEntryId,
        decisionNote: note,
        summary: approval.summary,
      },
      reason: note,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    notify(
      tx,
      [approval.requested_by],
      decision === "APPROVED" ? "Pengajuan disetujui" : "Pengajuan ditolak",
      `${approval.summary ?? approval.type} ${decision === "APPROVED" ? "disetujui" : "ditolak"} oleh ${user.name}.${note ? ` Catatan: ${note}` : ""}`,
      "/approvals",
    );

    if (approval.type === "OPNAME") {
      const sessionId = Number(payload.sessionId);
      tx.prepare(
        `UPDATE stock_opname_sessions
            SET status = ?, decided_by = ?, decided_at = ?, decision_note = ?, updated_at = ?
          WHERE id = ?`,
      ).run(
        decision === "APPROVED" ? "APPROVED" : "REJECTED",
        user.id,
        now,
        note,
        now,
        sessionId,
      );
    }

    return tx
      .prepare("SELECT * FROM approval_requests WHERE id = ?")
      .get(approval.id);
  });
}

function applyOpnameApprovalTx(
  tx: DatabaseSync,
  approval: ApprovalDetail,
  user: AuthUser,
): number | null {
  const payload = JSON.parse(approval.payload_json) as { sessionId: number };
  const session = tx
    .prepare("SELECT * FROM stock_opname_sessions WHERE id = ?")
    .get(payload.sessionId) as
    | {
        id: number;
        status: string;
        department_id: number;
        opname_date: string;
        notes: string | null;
      }
    | undefined;
  if (!session) throw new ValidationError("Sesi stok opname tidak ditemukan.");
  if (session.status !== "SUBMITTED")
    throw new ValidationError("Sesi stok opname tidak dalam status diajukan.");
  if (session.department_id !== approval.department_id) {
    throw new ValidationError(
      "Sesi stok opname berada di bagian yang berbeda.",
    );
  }

  const details = tx
    .prepare(
      `SELECT od.*, i.name AS item_name FROM stock_opname_details od
         JOIN items i ON i.id = od.item_id WHERE od.session_id = ?`,
    )
    .all(session.id) as Array<{
    id: number;
    item_id: number;
    system_qty: number;
    physical_qty: number | null;
    difference: number | null;
    reason: string | null;
    item_name: string;
  }>;

  // Cegah penyesuaian berbasis snapshot yang sudah kedaluwarsa.
  for (const detail of details) {
    const current = getBalance(tx, approval.department_id, detail.item_id);
    if (Math.abs(current - detail.system_qty) > 0.0001) {
      throw new ValidationError(
        `Stok ${detail.item_name} berubah sejak sesi opname dibuat (sistem saat ini ${current}, snapshot ${detail.system_qty}). ` +
          "Buat sesi stok opname baru agar koreksi tidak salah.",
      );
    }
  }

  let lastEntryId: number | null = null;
  for (const detail of details) {
    const difference = roundQty(
      Number(detail.physical_qty) - Number(detail.system_qty),
    );
    if (Math.abs(difference) < 0.0001) continue;
    const entry = postEntryTx(tx, {
      departmentId: approval.department_id,
      itemId: detail.item_id,
      entryType: "ADJUSTMENT",
      qtyDelta: difference,
      occurredAt: session.opname_date,
      sourceType: "OPNAME",
      sourceId: session.id,
      description: `Penyesuaian stok opname #${session.id} (${detail.item_name})`,
      reason: detail.reason ?? approval.reason ?? "Selisih stok opname",
      createdBy: user.id,
    });
    tx.prepare(
      "INSERT INTO stock_adjustments (entry_id, reason, approval_id, opname_detail_id, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(
      entry.id,
      detail.reason ?? approval.reason,
      approval.id,
      detail.id,
      nowIso(),
    );
    tx.prepare(
      "UPDATE stock_opname_details SET adjustment_entry_id = ?, updated_at = ? WHERE id = ?",
    ).run(entry.id, nowIso(), detail.id);
    lastEntryId = entry.id;
  }
  return lastEntryId;
}

/* ============================ STOK OPNAME ============================ */

export function createOpnameSession(
  user: AuthUser,
  input: {
    departmentId: number;
    opnameDate: string;
    period: string;
    notes?: string | null;
  },
  meta: { ip?: string; userAgent?: string },
) {
  return withTx((tx) => {
    const existing = tx
      .prepare(
        "SELECT 1 AS ok FROM stock_opname_sessions WHERE department_id = ? AND status IN ('DRAFT','SUBMITTED') LIMIT 1",
      )
      .get(input.departmentId);
    if (existing) {
      throw new ValidationError(
        "Sudah ada sesi stok opname aktif untuk bagian ini. Selesaikan sesi tersebut terlebih dahulu.",
      );
    }

    const now = nowIso();
    const result = tx
      .prepare(
        `INSERT INTO stock_opname_sessions
          (department_id, period, opname_date, status, notes, created_by, created_at, updated_at)
         VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?)`,
      )
      .run(
        input.departmentId,
        input.period,
        input.opnameDate,
        input.notes ?? null,
        user.id,
        now,
        now,
      );
    const sessionId = Number(result.lastInsertRowid);

    const items = tx
      .prepare(
        `SELECT i.id, COALESCE(b.qty, 0) AS qty
           FROM items i
           LEFT JOIN department_stock_balances b ON b.item_id = i.id AND b.department_id = ?
          WHERE (b.qty IS NOT NULL AND b.qty <> 0)
             OR EXISTS (SELECT 1 FROM stock_entries e WHERE e.department_id = ? AND e.item_id = i.id)
          ORDER BY i.name`,
      )
      .all(input.departmentId, input.departmentId) as Array<{
      id: number;
      qty: number;
    }>;

    if (!items.length) {
      throw new ValidationError(
        "Belum ada barang pada bagian ini yang dapat diopname.",
      );
    }
    for (const item of items) {
      tx.prepare(
        `INSERT INTO stock_opname_details
          (session_id, item_id, system_qty, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(sessionId, item.id, item.qty, now, now);
    }

    writeAudit(tx, {
      actor: user,
      action: "CREATE_OPNAME",
      entityType: "stock_opname_sessions",
      entityId: sessionId,
      after: {
        departmentId: input.departmentId,
        opnameDate: input.opnameDate,
        items: items.length,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { id: sessionId, itemCount: items.length };
  });
}

export function updateOpnameDetail(
  user: AuthUser,
  sessionId: number,
  detailId: number,
  input: { physicalQty: number; reason?: string | null },
) {
  return withTx((tx) => {
    const session = tx
      .prepare("SELECT * FROM stock_opname_sessions WHERE id = ?")
      .get(sessionId) as { status: string; department_id: number } | undefined;
    if (!session)
      throw new ValidationError("Sesi stok opname tidak ditemukan.");
    if (session.status !== "DRAFT")
      throw new ValidationError(
        "Sesi opname yang sudah diajukan tidak dapat diubah.",
      );
    const detail = tx
      .prepare(
        "SELECT * FROM stock_opname_details WHERE id = ? AND session_id = ?",
      )
      .get(detailId, sessionId) as
      | { id: number; system_qty: number }
      | undefined;
    if (!detail) throw new ValidationError("Rincian opname tidak ditemukan.");
    if (input.physicalQty < 0)
      throw new ValidationError("Jumlah fisik tidak boleh negatif.");
    const difference = roundQty(input.physicalQty - detail.system_qty);
    tx.prepare(
      "UPDATE stock_opname_details SET physical_qty = ?, difference = ?, reason = ?, updated_at = ? WHERE id = ?",
    ).run(
      input.physicalQty,
      difference,
      input.reason ?? null,
      nowIso(),
      detailId,
    );
    return { difference };
  });
}

export function submitOpname(
  user: AuthUser,
  sessionId: number,
  meta: { ip?: string; userAgent?: string },
) {
  return withTx((tx) => {
    const session = tx
      .prepare(
        `SELECT s.*, d.name AS department_name FROM stock_opname_sessions s
           JOIN departments d ON d.id = s.department_id WHERE s.id = ?`,
      )
      .get(sessionId) as
      | {
          id: number;
          status: string;
          department_id: number;
          department_name: string;
          opname_date: string;
        }
      | undefined;
    if (!session)
      throw new ValidationError("Sesi stok opname tidak ditemukan.");
    if (session.status !== "DRAFT")
      throw new ValidationError("Sesi opname ini sudah diajukan.");

    const details = tx
      .prepare("SELECT * FROM stock_opname_details WHERE session_id = ?")
      .all(sessionId) as Array<{
      physical_qty: number | null;
      difference: number | null;
      system_qty: number;
    }>;
    const missing = details.filter((detail) => detail.physical_qty === null);
    if (missing.length) {
      throw new ValidationError(
        `Masih ada ${missing.length} barang yang belum diisi jumlah fisiknya.`,
      );
    }

    const diffCount = details.filter(
      (detail) => Math.abs(Number(detail.difference)) > 0.0001,
    ).length;
    const approvalId = createApprovalTx(tx, user, {
      type: "OPNAME",
      departmentId: session.department_id,
      reason: `Hasil stok opname ${session.opname_date}`,
      summary: `Stok opname ${session.department_name} tanggal ${session.opname_date} (${diffCount} item selisih)`,
      payload: { sessionId },
    });
    const now = nowIso();
    tx.prepare(
      `UPDATE stock_opname_sessions SET status = 'SUBMITTED', submitted_at = ?, approval_id = ?, updated_at = ?
        WHERE id = ?`,
    ).run(now, approvalId, now, sessionId);
    writeAudit(tx, {
      actor: user,
      action: "SUBMIT_OPNAME",
      entityType: "stock_opname_sessions",
      entityId: sessionId,
      after: { approvalId, diffCount, itemCount: details.length },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { approvalId, diffCount };
  });
}

export function getApprovalForUser(
  user: AuthUser,
  approvalId: number,
): ApprovalRow {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM approval_requests WHERE id = ?")
    .get(approvalId) as ApprovalRow | undefined;
  if (!row) throw new ValidationError("Pengajuan tidak ditemukan.");
  if (!user.allDepartments && !user.departmentIds.includes(row.department_id)) {
    throw new ApiError(
      403,
      "Anda tidak memiliki akses ke pengajuan bagian ini.",
    );
  }
  return row;
}

export const approvalValidation = { validate };
