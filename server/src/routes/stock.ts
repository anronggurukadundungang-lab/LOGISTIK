import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db.ts";
import {
  ApiError,
  asyncHandler,
  clientIp,
  paginated,
  parsePage,
  validate,
} from "../lib/http.ts";
import { parseDateToIso, roundQty, todayLocal } from "../lib/utils.ts";
import {
  getBalance,
  recordConsumption,
  recordReturn,
  integrityCheck,
} from "../services/stock.ts";
import { createApprovalRequest } from "../services/workflow.ts";
import { requireAnyPermission, requirePermission } from "../lib/session.ts";
import { assertDepartmentAccess } from "../lib/auth.ts";
export const stockRouter = Router();
function scopedDepartmentClause(
  user: { allDepartments: boolean; departmentIds: number[] },
  column: string,
) {
  if (user.allDepartments) return { sql: "", params: [] as number[] };
  if (!user.departmentIds.length)
    return { sql: " AND 1 = 0", params: [] as number[] };
  return {
    sql: ` AND ${column} IN (${user.departmentIds.map(() => "?").join(",")})`,
    params: user.departmentIds,
  };
}
stockRouter.get(
  "/stocks",
  requirePermission("stocks.view"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const page = parsePage(req.query as Record<string, unknown>, 25);
    const search = String(req.query.search ?? "").trim();
    const departmentId = req.query.departmentId
      ? Number(req.query.departmentId)
      : null;
    const categoryId = req.query.categoryId
      ? Number(req.query.categoryId)
      : null;
    const itemId = req.query.itemId ? Number(req.query.itemId) : null;
    const stockStatus = String(req.query.status ?? "");
    const scope = scopedDepartmentClause(user, "b.department_id");
    const where: string[] = ["1 = 1"];
    const params: Array<string | number> = [];
    if (departmentId) {
      assertDepartmentAccess(user, departmentId);
      where.push("b.department_id = ?");
      params.push(departmentId);
    }
    if (search) {
      where.push("(i.name LIKE ? OR i.code LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    if (categoryId) {
      where.push("i.category_id = ?");
      params.push(categoryId);
    }
    if (itemId) {
      where.push("b.item_id = ?");
      params.push(itemId);
    }
    if (stockStatus === "critical") where.push("b.qty <= 0");
    if (stockStatus === "low") where.push("b.qty > 0 AND b.qty <= i.min_stock");
    if (stockStatus === "safe") where.push("b.qty > i.min_stock");
    const whereSql = `${where.join(" AND ")}${scope.sql}`;
    const db = getDb();
    const select = `      SELECT b.department_id, b.item_id, b.qty, b.updated_at,             d.name AS department_name, d.code AS department_code,             i.code AS item_code, i.name AS item_name, i.min_stock, i.simdondar_code,             u.code AS unit_code, u.name AS unit_name, c.name AS category_name, c.id AS category_id,             (SELECT COALESCE(SUM(CASE WHEN e.entry_type IN ('RECEIPT','OPENING') THEN e.qty_delta ELSE 0 END), 0)                FROM stock_entries e WHERE e.department_id = b.department_id AND e.item_id = b.item_id) AS received_total,             (SELECT COALESCE(-SUM(CASE WHEN e.entry_type = 'CONSUMPTION' THEN e.qty_delta ELSE 0 END), 0)                FROM stock_entries e WHERE e.department_id = b.department_id AND e.item_id = b.item_id) AS consumption_total,             (SELECT COALESCE(-SUM(CASE WHEN e.entry_type = 'RETURN' THEN e.qty_delta ELSE 0 END), 0)                FROM stock_entries e WHERE e.department_id = b.department_id AND e.item_id = b.item_id) AS return_total,             (SELECT COALESCE(-SUM(CASE WHEN e.entry_type IN ('DAMAGE','LOSS','EXPIRED') THEN e.qty_delta ELSE 0 END), 0)                FROM stock_entries e WHERE e.department_id = b.department_id AND e.item_id = b.item_id) AS damage_total,             (SELECT od.physical_qty FROM stock_opname_details od                JOIN stock_opname_sessions os ON os.id = od.session_id               WHERE os.department_id = b.department_id AND od.item_id = b.item_id                 AND os.status IN ('SUBMITTED','APPROVED')               ORDER BY os.opname_date DESC, os.id DESC LIMIT 1) AS physical_qty,             (SELECT od.difference FROM stock_opname_details od                JOIN stock_opname_sessions os ON os.id = od.session_id               WHERE os.department_id = b.department_id AND od.item_id = b.item_id                 AND os.status IN ('SUBMITTED','APPROVED')               ORDER BY os.opname_date DESC, os.id DESC LIMIT 1) AS opname_difference,             (SELECT os.opname_date FROM stock_opname_details od                JOIN stock_opname_sessions os ON os.id = od.session_id               WHERE os.department_id = b.department_id AND od.item_id = b.item_id                 AND os.status IN ('SUBMITTED','APPROVED')               ORDER BY os.opname_date DESC, os.id DESC LIMIT 1) AS last_opname_date        FROM department_stock_balances b        JOIN departments d ON d.id = b.department_id        JOIN items i ON i.id = b.item_id        JOIN units u ON u.id = i.base_unit_id        LEFT JOIN item_categories c ON c.id = i.category_id       WHERE ${whereSql}`;
    const total = Number(
      (
        db
          .prepare(`SELECT COUNT(*) AS total FROM (${select})`)
          .get(...params, ...scope.params) as { total: number }
      ).total,
    );
    const rows = db
      .prepare(`${select} ORDER BY d.name, i.name LIMIT ? OFFSET ?`)
      .all(...params, ...scope.params, page.pageSize, page.offset) as Array<
      Record<string, unknown>
    >;
    const items = rows.map((row) => ({
      ...row,
      stock_status:
        Number(row.qty) <= 0
          ? "critical"
          : Number(row.qty) <= Number(row.min_stock)
            ? "low"
            : "safe",
    }));
    res.json(paginated(items, total, page));
  }),
);
stockRouter.get(
  "/stocks/summary",
  requirePermission("stocks.view"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const scope = scopedDepartmentClause(user, "b.department_id");
    const db = getDb();
    const totals = db
      .prepare(
        `SELECT COUNT(*) AS row_count, COALESCE(SUM(b.qty), 0) AS total_qty,                SUM(CASE WHEN b.qty <= 0 THEN 1 ELSE 0 END) AS critical_count,                SUM(CASE WHEN b.qty > 0 AND b.qty <= i.min_stock THEN 1 ELSE 0 END) AS low_count           FROM department_stock_balances b JOIN items i ON i.id = b.item_id          WHERE b.qty <> 0 ${scope.sql}`,
      )
      .get(...scope.params);
    res.json({ summary: totals });
  }),
);
const entryFilter = (
  req: Parameters<typeof asyncHandler>[0] extends never ? never : any,
) => req;
stockRouter.get(
  "/stock-entries",
  requirePermission("stocks.view"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const page = parsePage(req.query as Record<string, unknown>, 30);
    const departmentId = req.query.departmentId
      ? Number(req.query.departmentId)
      : null;
    const itemId = req.query.itemId ? Number(req.query.itemId) : null;
    const type = String(req.query.type ?? "");
    const search = String(req.query.search ?? "").trim();
    const from = req.query.from ? parseDateToIso(req.query.from) : null;
    const to = req.query.to ? parseDateToIso(req.query.to) : null;
    if (departmentId) assertDepartmentAccess(user, departmentId);
    const scope = scopedDepartmentClause(user, "e.department_id");
    const where = ["1 = 1"];
    const params: Array<string | number> = [];
    if (departmentId) {
      where.push("e.department_id = ?");
      params.push(departmentId);
    }
    if (itemId) {
      where.push("e.item_id = ?");
      params.push(itemId);
    }
    if (type && type !== "ALL") {
      if (type === "ISSUE")
        where.push(
          "e.entry_type IN ('CONSUMPTION','RETURN','DAMAGE','LOSS','EXPIRED')",
        );
      else {
        where.push("e.entry_type = ?");
        params.push(type);
      }
    }
    if (from) {
      where.push("e.occurred_at >= ?");
      params.push(from);
    }
    if (to) {
      where.push("e.occurred_at <= ?");
      params.push(to);
    }
    if (search) {
      where.push(
        "(i.name LIKE ? OR e.entry_no LIKE ? OR e.source_ref LIKE ? OR e.description LIKE ?)",
      );
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    const whereSql = `${where.join(" AND ")}${scope.sql}`;
    const db = getDb();
    const total = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS total FROM stock_entries e JOIN items i ON i.id = e.item_id WHERE ${whereSql}`,
          )
          .get(...params, ...scope.params) as { total: number }
      ).total,
    );
    const items = db
      .prepare(
        `SELECT e.*, i.code AS item_code, i.name AS item_name, un.code AS unit_code,                d.name AS department_name, us.name AS created_by_name,                c.activity_category, c.officer_name, c.notes AS consumption_notes,                dmg.kind AS damage_kind, dmg.notes AS damage_notes,                r.destination AS return_destination, r.notes AS return_notes,                adj.reason AS adjustment_reason, st.source_doc_number,                rev.entry_no AS reversed_entry_no           FROM stock_entries e           JOIN items i ON i.id = e.item_id           JOIN units un ON un.id = e.unit_id           JOIN departments d ON d.id = e.department_id           JOIN users us ON us.id = e.created_by           LEFT JOIN stock_consumptions c ON c.entry_id = e.id           LEFT JOIN stock_damages dmg ON dmg.entry_id = e.id           LEFT JOIN stock_returns r ON r.entry_id = e.id           LEFT JOIN stock_adjustments adj ON adj.entry_id = e.id           LEFT JOIN simdondar_transactions st ON st.receipt_entry_id = e.id           LEFT JOIN stock_entries rev ON rev.id = e.reversed_entry_id          WHERE ${whereSql}          ORDER BY e.occurred_at DESC, e.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, ...scope.params, page.pageSize, page.offset);
    res.json(paginated(items, total, page));
  }),
);
stockRouter.get(
  "/stock-entries/:id",
  requirePermission("stocks.view"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const db = getDb();
    const row = db
      .prepare(
        `SELECT e.*, i.name AS item_name, i.code AS item_code, u.code AS unit_code,                d.name AS department_name, us.name AS created_by_name           FROM stock_entries e JOIN items i ON i.id = e.item_id           JOIN units u ON u.id = e.unit_id JOIN departments d ON d.id = e.department_id           JOIN users us ON us.id = e.created_by WHERE e.id = ?`,
      )
      .get(Number(req.params.id)) as Record<string, unknown> | undefined;
    if (!row) throw new ApiError(404, "Transaksi tidak ditemukan.");
    assertDepartmentAccess(user, Number(row.department_id));
    const audits = db
      .prepare(
        "SELECT * FROM audit_logs WHERE entity_type = 'stock_entries' AND (entity_id = ? OR entity_id LIKE ?) ORDER BY created_at DESC",
      )
      .all(String(row.id), `%,${row.id},%`);
    res.json({ item: row, audits });
  }),
);
/* ------------------------------- PEMAKAIAN ------------------------------- */ const consumptionSchema =
  z.object({
    departmentId: z.coerce.number().int().positive(),
    occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal tidak valid."),
    activityCategory: z.string().trim().max(100).optional().nullable(),
    officerName: z.string().trim().max(120).optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
    lines: z
      .array(
        z.object({
          itemId: z.coerce.number().int().positive(),
          qty: z.coerce.number().positive("Jumlah harus lebih dari 0."),
          unitId: z.coerce.number().int().positive().optional().nullable(),
          notes: z.string().trim().max(300).optional().nullable(),
        }),
      )
      .min(1, "Minimal satu barang.")
      .max(50),
  });
stockRouter.post(
  "/consumptions",
  requirePermission("consumptions.create"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const input = validate(consumptionSchema, req.body);
    assertDepartmentAccess(user, input.departmentId);
    if (input.occurredAt > todayLocal())
      throw new ApiError(422, "Tanggal pemakaian tidak boleh di masa depan.");
    const created = recordConsumption(
      user,
      { ...input, officerName: input.officerName || user.name },
      { ip: clientIp(req), userAgent: req.headers["user-agent"] ?? "" },
    );
    res
      .status(201)
      .json({
        message: `${created.length} transaksi pemakaian berhasil disimpan.`,
        items: created.map((row) => ({
          id: row.entry.id,
          entryNo: row.entry.entry_no,
          balanceAfter: row.entry.balance_after,
        })),
      });
  }),
);
stockRouter.get(
  "/consumptions/recent",
  requirePermission("stocks.view"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const scope = scopedDepartmentClause(user, "e.department_id");
    const departmentId = req.query.departmentId
      ? Number(req.query.departmentId)
      : null;
    if (departmentId) assertDepartmentAccess(user, departmentId);
    const params: number[] = [];
    let deptSql = "";
    if (departmentId) {
      deptSql = " AND e.department_id = ?";
      params.push(departmentId);
    }
    const rows = getDb()
      .prepare(
        `SELECT e.id, e.entry_no, e.occurred_at, e.qty_delta, e.balance_after, i.name AS item_name,                u.code AS unit_code, d.name AS department_name, us.name AS created_by_name,                c.activity_category, c.officer_name           FROM stock_entries e JOIN items i ON i.id = e.item_id           JOIN units u ON u.id = e.unit_id JOIN departments d ON d.id = e.department_id           JOIN users us ON us.id = e.created_by           JOIN stock_consumptions c ON c.entry_id = e.id          WHERE e.entry_type = 'CONSUMPTION' ${deptSql}${scope.sql}          ORDER BY e.created_at DESC LIMIT 20`,
      )
      .all(...params, ...scope.params);
    res.json({ items: rows });
  }),
);
/* --------------------------------- RETUR --------------------------------- */ const returnSchema =
  z.object({
    departmentId: z.coerce.number().int().positive(),
    itemId: z.coerce.number().int().positive(),
    qty: z.coerce.number().positive(),
    unitId: z.coerce.number().int().positive().optional().nullable(),
    occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    destination: z.string().trim().max(100).optional(),
    notes: z.string().trim().max(500).optional(),
  });
stockRouter.post(
  "/returns",
  requirePermission("returns.create"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const input = validate(returnSchema, req.body);
    assertDepartmentAccess(user, input.departmentId);
    if (input.occurredAt > todayLocal())
      throw new ApiError(422, "Tanggal retur tidak boleh di masa depan.");
    const entry = recordReturn(user, input, {
      ip: clientIp(req),
      userAgent: req.headers["user-agent"] ?? "",
    });
    res.status(201).json({ message: "Retur berhasil dicatat.", item: entry });
  }),
);
/* ----------------------- RUSAK / HILANG / KEDALUWARSA ----------------------- */ const damageSchema =
  z.object({
    departmentId: z.coerce.number().int().positive(),
    itemId: z.coerce.number().int().positive(),
    kind: z.enum(["DAMAGE", "LOSS", "EXPIRED"]),
    qty: z.coerce.number().positive(),
    occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notes: z.string().trim().min(5, "Keterangan minimal 5 karakter.").max(500),
    reason: z.string().trim().min(5, "Alasan minimal 5 karakter.").max(500),
  });
stockRouter.post(
  "/damages",
  requirePermission("damages.create"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const input = validate(damageSchema, req.body);
    assertDepartmentAccess(user, input.departmentId);
    const db = getDb();
    const item = db
      .prepare("SELECT name FROM items WHERE id = ?")
      .get(input.itemId) as { name: string } | undefined;
    if (!item) throw new ApiError(404, "Barang tidak ditemukan.");
    const balance = getBalance(db, input.departmentId, input.itemId);
    if (balance + 1e-9 < input.qty) {
      throw new ApiError(
        422,
        `Stok tersedia hanya ${balance}. Pengajuan tidak dapat melebihi stok.`,
      );
    }
    const label =
      input.kind === "DAMAGE"
        ? "Rusak"
        : input.kind === "LOSS"
          ? "Hilang"
          : "Kedaluwarsa";
    const approval = createApprovalRequest(user, {
      type: input.kind,
      departmentId: input.departmentId,
      itemId: input.itemId,
      reason: input.reason,
      summary: `${label} ${item.name} sebanyak ${input.qty} (${input.occurredAt})`,
      payload: {
        itemId: input.itemId,
        qty: input.qty,
        occurredAt: input.occurredAt,
        notes: input.notes,
      },
    });
    res
      .status(201)
      .json({
        message: `Pengajuan barang ${label.toLowerCase()} dikirim dan menunggu persetujuan.`,
        approval,
      });
  }),
);
/* ------------------------------- PENYESUAIAN ------------------------------- */ const adjustmentSchema =
  z.object({
    departmentId: z.coerce.number().int().positive(),
    itemId: z.coerce.number().int().positive(),
    qtyDelta: z.coerce
      .number()
      .refine(
        (value) => Math.abs(value) > 1e-9,
        "Jumlah penyesuaian tidak boleh nol.",
      ),
    occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z
      .string()
      .trim()
      .min(10, "Alasan penyesuaian minimal 10 karakter.")
      .max(500),
    description: z.string().trim().max(300).optional().nullable(),
  });
stockRouter.post(
  "/adjustments",
  requirePermission("adjustments.request"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const input = validate(adjustmentSchema, req.body);
    assertDepartmentAccess(user, input.departmentId);
    const db = getDb();
    const item = db
      .prepare("SELECT name FROM items WHERE id = ?")
      .get(input.itemId) as { name: string } | undefined;
    if (!item) throw new ApiError(404, "Barang tidak ditemukan.");
    const balance = getBalance(db, input.departmentId, input.itemId);
    if (roundQty(balance + input.qtyDelta) < 0) {
      throw new ApiError(
        422,
        `Penyesuaian akan membuat stok negatif (saldo saat ini ${balance}).`,
      );
    }
    const approval = createApprovalRequest(user, {
      type: "ADJUSTMENT",
      departmentId: input.departmentId,
      itemId: input.itemId,
      reason: input.reason,
      summary: `Penyesuaian ${item.name} ${input.qtyDelta > 0 ? "+" : ""}${input.qtyDelta} (${input.occurredAt})`,
      payload: {
        itemId: input.itemId,
        qtyDelta: input.qtyDelta,
        occurredAt: input.occurredAt,
        description: input.description ?? "Penyesuaian stok",
      },
    });
    res
      .status(201)
      .json({
        message: "Pengajuan penyesuaian dikirim dan menunggu persetujuan.",
        approval,
      });
  }),
);
/* ---------------------------- KOREKSI PEMAKAIAN ---------------------------- */ const correctionSchema =
  z.object({
    entryId: z.coerce.number().int().positive(),
    newQty: z.coerce.number().min(0),
    reason: z
      .string()
      .trim()
      .min(10, "Alasan koreksi minimal 10 karakter.")
      .max(500),
  });
stockRouter.post(
  "/corrections",
  requirePermission("consumptions.create"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const input = validate(correctionSchema, req.body);
    const db = getDb();
    const entry = db
      .prepare(
        `SELECT e.*, i.name AS item_name, c.activity_category, c.officer_name           FROM stock_entries e JOIN items i ON i.id = e.item_id           LEFT JOIN stock_consumptions c ON c.entry_id = e.id          WHERE e.id = ?`,
      )
      .get(input.entryId) as Record<string, unknown> | undefined;
    if (!entry) throw new ApiError(404, "Transaksi tidak ditemukan.");
    assertDepartmentAccess(user, Number(entry.department_id));
    if (entry.entry_type !== "CONSUMPTION")
      throw new ApiError(
        422,
        "Hanya transaksi pemakaian yang dapat dikoreksi.",
      );
    const reversed = db
      .prepare("SELECT 1 AS ok FROM stock_entries WHERE reversed_entry_id = ?")
      .get(input.entryId);
    if (reversed) throw new ApiError(422, "Transaksi ini sudah dikoreksi.");
    const approval = createApprovalRequest(user, {
      type: "CORRECTION",
      departmentId: Number(entry.department_id),
      itemId: Number(entry.item_id),
      reason: input.reason,
      summary: `Koreksi pemakaian ${entry.item_name} dari ${Math.abs(Number(entry.qty_delta))} menjadi ${input.newQty}`,
      payload: {
        entryId: input.entryId,
        newQty: input.newQty,
        originalEntryNo: entry.entry_no,
        activityCategory: entry.activity_category,
        officerName: entry.officer_name,
      },
    });
    res
      .status(201)
      .json({
        message: "Pengajuan koreksi pemakaian menunggu persetujuan.",
        approval,
      });
  }),
);
/* ------------------------------- INTEGRITAS ------------------------------- */ stockRouter.get(
  "/stocks/integrity",
  requirePermission("settings.manage"),
  asyncHandler(async (_req, res) => {
    res.json({ items: integrityCheck() });
  }),
);
stockRouter.post(
  "/stocks/integrity/recalculate",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const before = integrityCheck();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("DELETE FROM department_stock_balances");
      db.prepare(
        `INSERT INTO department_stock_balances (department_id, item_id, qty, updated_at)         SELECT department_id, item_id, ROUND(SUM(qty_delta), 6), ?           FROM stock_entries GROUP BY department_id, item_id`,
      ).run(new Date().toISOString());
      const { writeAudit } = await import("../lib/auth.ts");
      writeAudit(db, {
        actor: req.user!,
        action: "RECALCULATE_BALANCES",
        entityType: "department_stock_balances",
        before,
        after: { recalculated: true },
        ip: clientIp(req),
        userAgent: req.headers["user-agent"] ?? null,
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    res.json({
      message: "Saldo berhasil dihitung ulang dari ledger.",
      before,
      items: integrityCheck(),
    });
  }),
);
