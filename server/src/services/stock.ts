import type { DatabaseSync } from "node:sqlite";
import { getDb, nowIso, withTx } from "../db.ts";
import { ApiError, ValidationError } from "../lib/http.ts";
import { writeAudit, type AuthUser } from "../lib/auth.ts";
import { roundQty } from "../lib/utils.ts";

export type EntryType =
  | "RECEIPT"
  | "CONSUMPTION"
  | "RETURN"
  | "DAMAGE"
  | "LOSS"
  | "EXPIRED"
  | "ADJUSTMENT"
  | "REVERSAL"
  | "OPENING";

export interface PostEntryInput {
  departmentId: number;
  itemId: number;
  entryType: EntryType;
  qtyDelta: number;
  unitId?: number | null;
  occurredAt: string;
  sourceType?: string | null;
  sourceId?: string | number | null;
  sourceRef?: string | null;
  description?: string | null;
  reason?: string | null;
  createdBy: number;
  allowNegative?: boolean;
}

export interface StockEntryRow {
  id: number;
  entry_no: string;
  department_id: number;
  item_id: number;
  entry_type: EntryType;
  qty_delta: number;
  unit_id: number;
  balance_after: number;
  occurred_at: string;
  description: string | null;
}

interface ItemRow {
  id: number;
  code: string;
  name: string;
  base_unit_id: number;
  is_active: number;
}

interface DepartmentRow {
  id: number;
  name: string;
  is_active: number;
}

export function nextDocNo(
  tx: DatabaseSync,
  prefix: string,
  occurredAt: string,
): string {
  const period = occurredAt.slice(0, 7).replace("-", "");
  tx.prepare(
    "INSERT OR IGNORE INTO document_sequences (prefix, period, next_number) VALUES (?, ?, 1)",
  ).run(prefix, period);
  const row = tx
    .prepare(
      "SELECT next_number FROM document_sequences WHERE prefix = ? AND period = ?",
    )
    .get(prefix, period) as { next_number: number };
  tx.prepare(
    "UPDATE document_sequences SET next_number = next_number + 1 WHERE prefix = ? AND period = ?",
  ).run(prefix, period);
  return `${prefix}/${period}/${String(row.next_number).padStart(5, "0")}`;
}

export function getBalance(
  tx: DatabaseSync,
  departmentId: number,
  itemId: number,
): number {
  const row = tx
    .prepare(
      "SELECT qty FROM department_stock_balances WHERE department_id = ? AND item_id = ?",
    )
    .get(departmentId, itemId) as { qty: number } | undefined;
  return row?.qty ?? 0;
}

function resolveUnitQty(
  tx: DatabaseSync,
  item: { id: number; base_unit_id: number },
  qty: number,
  unitId?: number | null,
): { baseQty: number; unitId: number } {
  if (!unitId || unitId === item.base_unit_id) {
    return { baseQty: qty, unitId: item.base_unit_id };
  }
  const conversion = tx
    .prepare(
      "SELECT factor FROM item_unit_conversions WHERE item_id = ? AND from_unit_id = ?",
    )
    .get(item.id, unitId) as { factor: number } | undefined;
  if (!conversion) {
    throw new ValidationError(
      "Satuan yang dipilih belum memiliki konversi ke satuan dasar barang ini. Atur konversi pada master barang.",
    );
  }
  return { baseQty: qty * conversion.factor, unitId: item.base_unit_id };
}

export function postEntryTx(
  tx: DatabaseSync,
  input: PostEntryInput,
): StockEntryRow {
  if (!Number.isFinite(input.qtyDelta) || Math.abs(input.qtyDelta) < 1e-9) {
    throw new ValidationError("Jumlah transaksi harus lebih dari nol.");
  }
  const item = tx
    .prepare(
      "SELECT id, code, name, base_unit_id, is_active FROM items WHERE id = ?",
    )
    .get(input.itemId) as ItemRow | undefined;
  if (!item) throw new ValidationError("Barang tidak ditemukan.");
  if (!item.is_active)
    throw new ValidationError(`Barang ${item.name} sedang nonaktif.`);

  const department = tx
    .prepare("SELECT id, name, is_active FROM departments WHERE id = ?")
    .get(input.departmentId) as DepartmentRow | undefined;
  if (!department) throw new ValidationError("Bagian tidak ditemukan.");
  if (!department.is_active)
    throw new ValidationError(`Bagian ${department.name} sedang nonaktif.`);

  if (["RECEIPT", "OPENING"].includes(input.entryType) && input.qtyDelta <= 0) {
    throw new ValidationError("Transaksi penerimaan harus bernilai positif.");
  }
  if (
    ["CONSUMPTION", "RETURN", "DAMAGE", "LOSS", "EXPIRED"].includes(
      input.entryType,
    ) &&
    input.qtyDelta >= 0
  ) {
    throw new ValidationError("Transaksi pengurangan harus bernilai negatif.");
  }

  const qtyDelta = roundQty(input.qtyDelta);
  const current = getBalance(tx, input.departmentId, item.id);
  const newBalance = roundQty(current + qtyDelta);
  if (newBalance < -1e-9 && !input.allowNegative) {
    throw new ValidationError(
      `Stok ${item.name} tidak mencukupi. Saldo tersedia ${current} ${unitCode(tx, item.base_unit_id)}, diminta ${Math.abs(qtyDelta)}.`,
    );
  }
  if (newBalance < -1e-9) {
    throw new ValidationError("Saldo stok tidak boleh negatif.");
  }

  const entryNo = nextDocNo(tx, "STK", input.occurredAt);
  const now = nowIso();
  const result = tx
    .prepare(
      `INSERT INTO stock_entries
        (entry_no, department_id, item_id, entry_type, qty_delta, unit_id, balance_after, occurred_at,
         posted_at, source_type, source_id, source_ref, description, reason, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entryNo,
      input.departmentId,
      item.id,
      input.entryType,
      qtyDelta,
      item.base_unit_id,
      Math.max(0, newBalance),
      input.occurredAt,
      now,
      input.sourceType ?? null,
      input.sourceId !== null && input.sourceId !== undefined
        ? String(input.sourceId)
        : null,
      input.sourceRef ?? null,
      input.description ?? null,
      input.reason ?? null,
      input.createdBy,
      now,
    );

  tx.prepare(
    `INSERT INTO department_stock_balances (department_id, item_id, qty, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(department_id, item_id) DO UPDATE SET qty = excluded.qty, updated_at = excluded.updated_at`,
  ).run(input.departmentId, item.id, Math.max(0, newBalance), now);

  return {
    id: Number(result.lastInsertRowid),
    entry_no: entryNo,
    department_id: input.departmentId,
    item_id: item.id,
    entry_type: input.entryType,
    qty_delta: qtyDelta,
    unit_id: item.base_unit_id,
    balance_after: Math.max(0, newBalance),
    occurred_at: input.occurredAt,
    description: input.description ?? null,
  };
}

export function unitCode(tx: DatabaseSync, unitId: number): string {
  const row = tx.prepare("SELECT code FROM units WHERE id = ?").get(unitId) as
    | { code: string }
    | undefined;
  return row?.code ?? "";
}

export function entryWithItem(tx: DatabaseSync, entryId: number) {
  return tx
    .prepare(
      `SELECT e.*, i.code AS item_code, i.name AS item_name, u.code AS unit_code,
              d.name AS department_name, us.name AS created_by_name
         FROM stock_entries e
         JOIN items i ON i.id = e.item_id
         JOIN units u ON u.id = e.unit_id
         JOIN departments d ON d.id = e.department_id
         JOIN users us ON us.id = e.created_by
        WHERE e.id = ?`,
    )
    .get(entryId) as Record<string, unknown> | undefined;
}

export function reverseEntryTx(
  tx: DatabaseSync,
  entryId: number,
  userId: number,
  reason: string,
): StockEntryRow {
  const original = tx
    .prepare("SELECT * FROM stock_entries WHERE id = ?")
    .get(entryId) as
    | {
        id: number;
        department_id: number;
        item_id: number;
        unit_id: number;
        qty_delta: number;
        occurred_at: string;
        entry_no: string;
        entry_type: string;
        reversed_entry_id?: number | null;
      }
    | undefined;
  if (!original)
    throw new ValidationError("Transaksi yang akan dikoreksi tidak ditemukan.");
  if (original.entry_type === "REVERSAL")
    throw new ValidationError("Transaksi pembalik tidak dapat dibalik lagi.");
  const existing = tx
    .prepare("SELECT 1 AS ok FROM stock_entries WHERE reversed_entry_id = ?")
    .get(entryId);
  if (existing)
    throw new ValidationError("Transaksi ini sudah pernah dikoreksi/dibalik.");

  const reversal = postEntryTx(tx, {
    departmentId: original.department_id,
    itemId: original.item_id,
    entryType: "REVERSAL",
    qtyDelta: -original.qty_delta,
    occurredAt: original.occurred_at,
    sourceType: "REVERSAL",
    sourceId: entryId,
    sourceRef: original.entry_no,
    description: `Pembalik transaksi ${original.entry_no}`,
    reason,
    createdBy: userId,
    allowNegative: true,
  });
  tx.prepare(
    `UPDATE stock_entries SET is_reversal = 1, reversed_entry_id = ? WHERE id = ?`,
  ).run(entryId, reversal.id);
  return reversal;
}

export interface ConsumptionLine {
  itemId: number;
  qty: number;
  unitId?: number | null;
  notes?: string | null;
}

export function recordConsumption(
  user: AuthUser,
  input: {
    departmentId: number;
    occurredAt: string;
    activityCategory?: string | null;
    officerName?: string | null;
    notes?: string | null;
    lines: ConsumptionLine[];
  },
  meta: { ip?: string; userAgent?: string },
) {
  return withTx((tx) => {
    if (!input.lines.length)
      throw new ValidationError("Minimal satu barang harus diisi.");
    const created: Array<{
      entry: StockEntryRow;
      itemName: string;
      qty: number;
    }> = [];
    for (const line of input.lines) {
      const item = tx
        .prepare("SELECT id, name, base_unit_id FROM items WHERE id = ?")
        .get(line.itemId) as
        | { id: number; name: string; base_unit_id: number }
        | undefined;
      if (!item)
        throw new ValidationError(
          "Barang pada salah satu baris tidak ditemukan.",
        );
      const { baseQty, unitId } = resolveUnitQty(
        tx,
        item,
        line.qty,
        line.unitId,
      );
      const entry = postEntryTx(tx, {
        departmentId: input.departmentId,
        itemId: line.itemId,
        entryType: "CONSUMPTION",
        qtyDelta: -baseQty,
        unitId,
        occurredAt: input.occurredAt,
        sourceType: "MANUAL",
        description: input.notes ?? "Pemakaian barang",
        createdBy: user.id,
      });
      tx.prepare(
        `INSERT INTO stock_consumptions
          (entry_id, activity_category, officer_name, notes, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(
        entry.id,
        input.activityCategory ?? null,
        input.officerName ?? null,
        line.notes ?? input.notes ?? null,
        nowIso(),
      );
      created.push({ entry, itemName: item.name, qty: baseQty });
    }

    const department = tx
      .prepare("SELECT name FROM departments WHERE id = ?")
      .get(input.departmentId) as { name: string };
    writeAudit(tx, {
      actor: user,
      action: "CREATE_CONSUMPTION",
      entityType: "stock_entries",
      entityId: created.map((item) => item.entry.id).join(","),
      after: {
        department: department.name,
        occurredAt: input.occurredAt,
        officerName: input.officerName,
        lines: created.map((item) => ({
          entryNo: item.entry.entry_no,
          item: item.itemName,
          qty: item.qty,
          balanceAfter: item.entry.balance_after,
        })),
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return created;
  });
}

export function recordReturn(
  user: AuthUser,
  input: {
    departmentId: number;
    itemId: number;
    qty: number;
    unitId?: number | null;
    occurredAt: string;
    destination?: string;
    notes?: string;
  },
  meta: { ip?: string; userAgent?: string },
) {
  return withTx((tx) => {
    const item = tx
      .prepare("SELECT id, name, base_unit_id FROM items WHERE id = ?")
      .get(input.itemId) as
      | { id: number; name: string; base_unit_id: number }
      | undefined;
    if (!item) throw new ValidationError("Barang tidak ditemukan.");
    const { baseQty, unitId } = resolveUnitQty(
      tx,
      item,
      input.qty,
      input.unitId,
    );
    const entry = postEntryTx(tx, {
      departmentId: input.departmentId,
      itemId: input.itemId,
      entryType: "RETURN",
      qtyDelta: -baseQty,
      unitId,
      occurredAt: input.occurredAt,
      sourceType: "MANUAL",
      description: input.notes ?? "Retur ke Logistik",
      createdBy: user.id,
    });
    tx.prepare(
      "INSERT INTO stock_returns (entry_id, destination, notes, created_at) VALUES (?, ?, ?, ?)",
    ).run(
      entry.id,
      input.destination ?? "LOGISTIK",
      input.notes ?? null,
      nowIso(),
    );
    writeAudit(tx, {
      actor: user,
      action: "CREATE_RETURN",
      entityType: "stock_entries",
      entityId: entry.id,
      after: {
        entryNo: entry.entry_no,
        item: item.name,
        qty: baseQty,
        destination: input.destination,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return entry;
  });
}

export function confirmReceipt(
  user: AuthUser,
  transactionId: number,
  input: { qtyReceived?: number | null; note?: string | null },
  meta: { ip?: string; userAgent?: string },
) {
  return withTx((tx) => {
    const txn = tx
      .prepare(
        `SELECT t.*, i.name AS item_name, d.name AS department_name
           FROM simdondar_transactions t
           JOIN items i ON i.id = t.item_id
           JOIN departments d ON d.id = t.department_id
          WHERE t.id = ?`,
      )
      .get(transactionId) as
      | {
          id: number;
          department_id: number;
          item_id: number;
          qty_issued: number;
          qty_received: number | null;
          status: string;
          source_identity: string;
          source_doc_number: string | null;
          source_date: string;
          item_name: string;
          department_name: string;
        }
      | undefined;
    if (!txn) throw new ValidationError("Transaksi SIMDONDAR tidak ditemukan.");
    if (!["AWAITING_RECEIPT", "DISPUTED"].includes(txn.status)) {
      throw new ValidationError(
        "Transaksi ini sudah dikonfirmasi atau dibatalkan.",
      );
    }
    const qty = roundQty(input.qtyReceived ?? txn.qty_issued);
    if (!Number.isFinite(qty) || qty <= 0)
      throw new ValidationError("Jumlah diterima harus lebih dari nol.");
    if (qty > txn.qty_issued + 1e-9) {
      throw new ValidationError(
        `Jumlah diterima (${qty}) tidak boleh melebihi jumlah keluar SIMDONDAR (${txn.qty_issued}).`,
      );
    }

    const entry = postEntryTx(tx, {
      departmentId: txn.department_id,
      itemId: txn.item_id,
      entryType: "RECEIPT",
      qtyDelta: qty,
      occurredAt: txn.source_date,
      sourceType: "SIMDONDAR",
      sourceId: txn.id,
      sourceRef: txn.source_doc_number ?? txn.source_identity,
      description: `Penerimaan dari SIMDONDAR${txn.source_doc_number ? ` (${txn.source_doc_number})` : ""}`,
      createdBy: user.id,
    });

    const discrepancy = Math.abs(qty - txn.qty_issued) > 1e-9;
    const status = discrepancy ? "RECEIVED_WITH_DISCREPANCY" : "RECEIVED";
    tx.prepare(
      `UPDATE simdondar_transactions
          SET status = ?, qty_received = ?, receipt_entry_id = ?, received_by = ?, received_at = ?,
              received_note = ?, updated_at = ?
        WHERE id = ?`,
    ).run(
      status,
      qty,
      entry.id,
      user.id,
      nowIso(),
      input.note ?? null,
      nowIso(),
      txn.id,
    );

    writeAudit(tx, {
      actor: user,
      action: discrepancy ? "RECEIPT_DISCREPANCY" : "RECEIPT_CONFIRMED",
      entityType: "simdondar_transactions",
      entityId: txn.id,
      before: { status: txn.status, qtyReceived: txn.qty_received },
      after: {
        status,
        qtyIssued: txn.qty_issued,
        qtyReceived: qty,
        entryNo: entry.entry_no,
        item: txn.item_name,
        department: txn.department_name,
        note: input.note ?? null,
      },
      reason: input.note ?? null,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return {
      entry,
      status,
      discrepancy,
      difference: roundQty(qty - txn.qty_issued),
    };
  });
}

export function findApproverIds(
  tx: DatabaseSync,
  departmentId: number,
  excludeUserId?: number,
): number[] {
  const rows = tx
    .prepare(
      `SELECT DISTINCT u.id
         FROM users u
         JOIN role_permissions rp ON rp.role_id = u.role_id
         JOIN permissions p ON p.id = rp.permission_id AND p.code = 'approvals.decide'
         LEFT JOIN user_departments ud ON ud.user_id = u.id
         LEFT JOIN role_permissions rpa ON rpa.role_id = u.role_id
         LEFT JOIN permissions pa ON pa.id = rpa.permission_id AND pa.code = 'stocks.view_all'
        WHERE u.is_active = 1
          AND (ud.department_id = ? OR pa.code IS NOT NULL)
          AND u.id <> ?`,
    )
    .all(departmentId, excludeUserId ?? 0) as Array<{ id: number }>;
  return rows.map((row) => row.id);
}

export function departmentName(departmentId: number): string {
  const row = getDb()
    .prepare("SELECT name FROM departments WHERE id = ?")
    .get(departmentId) as { name: string } | undefined;
  return row?.name ?? "-";
}

export function integrityCheck(departmentId?: number): Array<{
  departmentId: number;
  departmentName: string;
  itemId: number;
  itemCode: string;
  itemName: string;
  cachedQty: number;
  ledgerQty: number;
  difference: number;
}> {
  const db = getDb();
  const conditions = departmentId
    ? "WHERE b.department_id = ? AND b.qty <> 0"
    : "WHERE b.qty <> 0";
  const rows = db
    .prepare(
      `SELECT b.department_id, d.name AS department_name, b.item_id, i.code AS item_code,
              i.name AS item_name, b.qty AS cached_qty,
              COALESCE((SELECT SUM(e.qty_delta) FROM stock_entries e
                         WHERE e.department_id = b.department_id AND e.item_id = b.item_id), 0) AS ledger_qty
         FROM department_stock_balances b
         JOIN departments d ON d.id = b.department_id
         JOIN items i ON i.id = b.item_id
         ${conditions}`,
    )
    .all(...(departmentId ? [departmentId] : [])) as Array<
    Record<string, number | string>
  >;
  return rows
    .map((row) => ({
      departmentId: Number(row.department_id),
      departmentName: String(row.department_name),
      itemId: Number(row.item_id),
      itemCode: String(row.item_code),
      itemName: String(row.item_name),
      cachedQty: Number(row.cached_qty),
      ledgerQty: Number(row.ledger_qty),
      difference: roundQty(Number(row.cached_qty) - Number(row.ledger_qty)),
    }))
    .filter((row) => Math.abs(row.difference) > 0.0001);
}
