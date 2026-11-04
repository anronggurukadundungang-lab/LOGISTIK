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
import { createOpnameSession, submitOpname } from "../services/workflow.ts";
import { parseDateToIso } from "../lib/utils.ts";
import { requirePermission } from "../lib/session.ts";
import { assertDepartmentAccess } from "../lib/auth.ts";
export const opnamesRouter = Router();
opnamesRouter.get(
  "/opnames",
  requirePermission("approvals.view"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const page = parsePage(req.query as Record<string, unknown>, 20);
    const status = String(req.query.status ?? "");
    const departmentId = req.query.departmentId
      ? Number(req.query.departmentId)
      : null;
    if (departmentId) assertDepartmentAccess(user, departmentId);
    const where: string[] = ["1 = 1"];
    const params: Array<string | number> = [];
    if (status && status !== "ALL") {
      where.push("s.status = ?");
      params.push(status);
    }
    if (departmentId) {
      where.push("s.department_id = ?");
      params.push(departmentId);
    }
    if (!user.allDepartments) {
      if (!user.departmentIds.length) {
        res.json(paginated([], 0, page));
        return;
      }
      where.push(
        `s.department_id IN (${user.departmentIds.map(() => "?").join(",")})`,
      );
      params.push(...user.departmentIds);
    }
    const whereSql = where.join(" AND ");
    const db = getDb();
    const total = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS total FROM stock_opname_sessions s WHERE ${whereSql}`,
          )
          .get(...params) as { total: number }
      ).total,
    );
    const items = db
      .prepare(
        `SELECT s.*, d.name AS department_name, u.name AS created_by_name,                (SELECT COUNT(*) FROM stock_opname_details od WHERE od.session_id = s.id) AS item_count,                (SELECT COUNT(*) FROM stock_opname_details od WHERE od.session_id = s.id                  AND ABS(COALESCE(od.difference, 0)) > 0.0001) AS diff_count,                (SELECT COUNT(*) FROM stock_opname_details od WHERE od.session_id = s.id                  AND od.physical_qty IS NULL) AS unfilled_count           FROM stock_opname_sessions s           JOIN departments d ON d.id = s.department_id           JOIN users u ON u.id = s.created_by          WHERE ${whereSql}          ORDER BY s.opname_date DESC, s.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, page.pageSize, page.offset);
    res.json(paginated(items, total, page));
  }),
);
const createSchema = z.object({
  departmentId: z.coerce.number().int().positive(),
  opnameDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  notes: z.string().trim().max(500).optional().nullable(),
});
opnamesRouter.post(
  "/opnames",
  requirePermission("opnames.create"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const input = validate(createSchema, req.body);
    assertDepartmentAccess(user, input.departmentId);
    const date = parseDateToIso(input.opnameDate);
    if (!date) throw new ApiError(422, "Tanggal opname tidak valid.");
    if (date > new Date().toISOString().slice(0, 10)) {
      throw new ApiError(422, "Tanggal opname tidak boleh di masa depan.");
    }
    const result = createOpnameSession(
      user,
      {
        departmentId: input.departmentId,
        opnameDate: date,
        period: input.period ?? date.slice(0, 7),
        notes: input.notes,
      },
      { ip: clientIp(req), userAgent: req.headers["user-agent"] ?? "" },
    );
    res
      .status(201)
      .json({
        message: `Sesi opname dibuat dengan ${result.itemCount} barang.`,
        ...result,
      });
  }),
);
opnamesRouter.get(
  "/opnames/:id",
  requirePermission("approvals.view"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const db = getDb();
    const session = db
      .prepare(
        `SELECT s.*, d.name AS department_name, u.name AS created_by_name, du.name AS decided_by_name           FROM stock_opname_sessions s JOIN departments d ON d.id = s.department_id           JOIN users u ON u.id = s.created_by LEFT JOIN users du ON du.id = s.decided_by          WHERE s.id = ?`,
      )
      .get(Number(req.params.id)) as Record<string, unknown> | undefined;
    if (!session) throw new ApiError(404, "Sesi opname tidak ditemukan.");
    assertDepartmentAccess(user, Number(session.department_id));
    const details = db
      .prepare(
        `SELECT od.*, i.code AS item_code, i.name AS item_name, un.code AS unit_code,                (SELECT COALESCE(b.qty, 0) FROM department_stock_balances b                  WHERE b.department_id = ? AND b.item_id = od.item_id) AS current_qty,                (SELECT e.entry_no FROM stock_entries e WHERE e.id = od.adjustment_entry_id) AS adjustment_entry_no           FROM stock_opname_details od           JOIN items i ON i.id = od.item_id           JOIN units un ON un.id = i.base_unit_id          WHERE od.session_id = ? ORDER BY i.name`,
      )
      .all(Number(session.department_id), Number(session.id));
    const approval = session.approval_id
      ? db
          .prepare("SELECT * FROM approval_requests WHERE id = ?")
          .get(Number(session.approval_id))
      : null;
    res.json({ item: session, details, approval });
  }),
);
opnamesRouter.post(
  "/opnames/:id/submit",
  requirePermission("opnames.create"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const db = getDb();
    const session = db
      .prepare("SELECT * FROM stock_opname_sessions WHERE id = ?")
      .get(Number(req.params.id)) as
      | { department_id: number; created_by: number }
      | undefined;
    if (!session) throw new ApiError(404, "Sesi opname tidak ditemukan.");
    assertDepartmentAccess(user, session.department_id);
    const result = submitOpname(user, Number(req.params.id), {
      ip: clientIp(req),
      userAgent: req.headers["user-agent"] ?? "",
    });
    res.json({
      message: "Hasil opname diajukan untuk persetujuan. Saldo belum berubah.",
      ...result,
    });
  }),
);
