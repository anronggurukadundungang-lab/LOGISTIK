import { Router } from "express";
import { z } from "zod";
import { getDb, nowIso, withTx } from "../db.ts";
import {
  ApiError,
  asyncHandler,
  clientIp,
  paginated,
  parsePage,
  validate,
} from "../lib/http.ts";
import { confirmReceipt } from "../services/stock.ts";
import { requirePermission } from "../lib/session.ts";
import { assertDepartmentAccess, writeAudit } from "../lib/auth.ts";
export const receiptsRouter = Router();
receiptsRouter.get(
  "/receipts",
  requirePermission("receipts.confirm"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const page = parsePage(req.query as Record<string, unknown>, 20);
    const status = String(req.query.status ?? "AWAITING_RECEIPT");
    const search = String(req.query.search ?? "").trim();
    const departmentId = req.query.departmentId
      ? Number(req.query.departmentId)
      : null;
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (status && status !== "ALL") {
      where.push("t.status = ?");
      params.push(status);
    }
    if (search) {
      where.push(
        "(t.source_doc_number LIKE ? OR i.name LIKE ? OR i.code LIKE ?)",
      );
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (departmentId) {
      assertDepartmentAccess(user, departmentId);
      where.push("t.department_id = ?");
      params.push(departmentId);
    } else if (!user.allDepartments) {
      if (!user.departmentIds.length) {
        res.json(paginated([], 0, page));
        return;
      }
      where.push(
        `t.department_id IN (${user.departmentIds.map(() => "?").join(",")})`,
      );
      params.push(...user.departmentIds);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const db = getDb();
    const total = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS total FROM simdondar_transactions t               JOIN items i ON i.id = t.item_id ${whereSql}`,
          )
          .get(...params) as { total: number }
      ).total,
    );
    const items = db
      .prepare(
        `SELECT t.*, i.code AS item_code, i.name AS item_name, u.code AS unit_code,                d.name AS department_name, b.filename AS import_filename,                ub.name AS received_by_name           FROM simdondar_transactions t           JOIN items i ON i.id = t.item_id           JOIN units u ON u.id = t.unit_id           JOIN departments d ON d.id = t.department_id           LEFT JOIN simdondar_import_batches b ON b.id = t.import_batch_id           LEFT JOIN users ub ON ub.id = t.received_by           ${whereSql}          ORDER BY t.source_date DESC, t.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, page.pageSize, page.offset);
    const counts = db
      .prepare(
        `SELECT status, COUNT(*) AS count FROM simdondar_transactions          ${user.allDepartments ? "" : `WHERE department_id IN (${user.departmentIds.map(() => "?").join(",") || "NULL"})`}          GROUP BY status`,
      )
      .all(...(user.allDepartments ? [] : user.departmentIds)) as Array<{
      status: string;
      count: number;
    }>;
    res.json({
      ...paginated(items, total, page),
      counts: Object.fromEntries(counts.map((row) => [row.status, row.count])),
    });
  }),
);
const confirmSchema = z.object({
  qtyReceived: z.coerce.number().positive().optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});
receiptsRouter.post(
  "/receipts/:id/confirm",
  requirePermission("receipts.confirm"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const db = getDb();
    const txn = db
      .prepare("SELECT department_id FROM simdondar_transactions WHERE id = ?")
      .get(Number(req.params.id)) as { department_id: number } | undefined;
    if (!txn) throw new ApiError(404, "Transaksi tidak ditemukan.");
    assertDepartmentAccess(user, txn.department_id);
    const input = validate(confirmSchema, req.body ?? {});
    const result = confirmReceipt(user, Number(req.params.id), input, {
      ip: clientIp(req),
      userAgent: req.headers["user-agent"] ?? "",
    });
    res.json(result);
  }),
);
receiptsRouter.post(
  "/receipts/:id/dispute",
  requirePermission("receipts.confirm"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const input = validate(
      z.object({
        note: z.string().trim().min(5, "Jelaskan alasan sengketa.").max(500),
      }),
      req.body,
    );
    const result = withTx((tx) => {
      const txn = tx
        .prepare("SELECT * FROM simdondar_transactions WHERE id = ?")
        .get(Number(req.params.id)) as Record<string, unknown> | undefined;
      if (!txn) throw new ApiError(404, "Transaksi tidak ditemukan.");
      assertDepartmentAccess(user, Number(txn.department_id));
      if (!["AWAITING_RECEIPT", "DISPUTED"].includes(String(txn.status))) {
        throw new ApiError(
          422,
          "Transaksi yang sudah diterima tidak dapat disengketakan.",
        );
      }
      tx.prepare(
        "UPDATE simdondar_transactions SET status = 'DISPUTED', received_note = ?, updated_at = ? WHERE id = ?",
      ).run(input.note, nowIso(), Number(txn.id));
      writeAudit(tx, {
        actor: user,
        action: "RECEIPT_DISPUTED",
        entityType: "simdondar_transactions",
        entityId: Number(txn.id),
        before: { status: txn.status },
        after: { status: "DISPUTED", note: input.note },
        reason: input.note,
        ip: clientIp(req),
        userAgent: req.headers["user-agent"] ?? null,
      });
      return tx
        .prepare("SELECT * FROM simdondar_transactions WHERE id = ?")
        .get(Number(txn.id));
    });
    res.json({ item: result });
  }),
);
