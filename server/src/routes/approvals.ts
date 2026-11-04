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
import {
  decideApproval,
  getApprovalForUser,
  updateOpnameDetail,
} from "../services/workflow.ts";
import { requirePermission } from "../lib/session.ts";
import { assertDepartmentAccess } from "../lib/auth.ts";
export const approvalsRouter = Router();
approvalsRouter.get(
  "/approvals",
  requirePermission("approvals.view"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const page = parsePage(req.query as Record<string, unknown>, 20);
    const status = String(req.query.status ?? "PENDING");
    const type = String(req.query.type ?? "");
    const departmentId = req.query.departmentId
      ? Number(req.query.departmentId)
      : null;
    if (departmentId) assertDepartmentAccess(user, departmentId);
    const where: string[] = ["1 = 1"];
    const params: Array<string | number> = [];
    if (status && status !== "ALL") {
      where.push("a.status = ?");
      params.push(status);
    }
    if (type && type !== "ALL") {
      where.push("a.type = ?");
      params.push(type);
    }
    if (departmentId) {
      where.push("a.department_id = ?");
      params.push(departmentId);
    }
    if (!user.allDepartments) {
      if (!user.departmentIds.length) {
        res.json(paginated([], 0, page));
        return;
      }
      where.push(
        `a.department_id IN (${user.departmentIds.map(() => "?").join(",")})`,
      );
      params.push(...user.departmentIds);
    }
    const whereSql = where.join(" AND ");
    const db = getDb();
    const total = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS total FROM approval_requests a WHERE ${whereSql}`,
          )
          .get(...params) as { total: number }
      ).total,
    );
    const rows = db
      .prepare(
        `SELECT a.*, d.name AS department_name, i.name AS item_name, i.code AS item_code,                u.name AS requester_name, du.name AS decided_by_name           FROM approval_requests a           JOIN departments d ON d.id = a.department_id           LEFT JOIN items i ON i.id = a.item_id           JOIN users u ON u.id = a.requested_by           LEFT JOIN users du ON du.id = a.decided_by          WHERE ${whereSql}          ORDER BY CASE a.status WHEN 'PENDING' THEN 0 ELSE 1 END, a.created_at DESC          LIMIT ? OFFSET ?`,
      )
      .all(...params, page.pageSize, page.offset) as Array<
      Record<string, unknown>
    >;
    res.json({
      ...paginated(
        rows.map((row) => ({
          ...row,
          payload: JSON.parse(String(row.payload_json)),
          is_own_request: Number(row.requested_by) === user.id,
        })),
        total,
        page,
      ),
    });
  }),
);
approvalsRouter.get(
  "/approvals/:id",
  requirePermission("approvals.view"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const approval = getApprovalForUser(user, Number(req.params.id));
    const db = getDb();
    const detail = db
      .prepare(
        `SELECT a.*, d.name AS department_name, i.name AS item_name, i.code AS item_code,                u.name AS requester_name, du.name AS decided_by_name           FROM approval_requests a JOIN departments d ON d.id = a.department_id           LEFT JOIN items i ON i.id = a.item_id           JOIN users u ON u.id = a.requested_by           LEFT JOIN users du ON du.id = a.decided_by          WHERE a.id = ?`,
      )
      .get(approval.id) as Record<string, unknown>;
    let opname = null;
    if (approval.type === "OPNAME") {
      const payload = JSON.parse(approval.payload_json) as {
        sessionId: number;
      };
      opname = db
        .prepare("SELECT * FROM stock_opname_sessions WHERE id = ?")
        .get(payload.sessionId);
    }
    res.json({
      item: { ...detail, payload: JSON.parse(approval.payload_json) },
      opname,
    });
  }),
);
const decisionSchema = z.object({
  note: z.string().trim().max(500).optional().nullable(),
});
approvalsRouter.post(
  "/approvals/:id/approve",
  requirePermission("approvals.decide"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const input = validate(decisionSchema, req.body ?? {});
    const approval = getApprovalForUser(user, Number(req.params.id));
    const result = decideApproval(
      user,
      approval.id,
      "APPROVED",
      input.note ?? null,
      { ip: clientIp(req), userAgent: req.headers["user-agent"] ?? "" },
    );
    res.json({
      message: "Pengajuan disetujui dan transaksi telah dibukukan.",
      item: result,
    });
  }),
);
approvalsRouter.post(
  "/approvals/:id/reject",
  requirePermission("approvals.decide"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const input = validate(
      z.object({
        note: z
          .string()
          .trim()
          .min(5, "Alasan penolakan wajib diisi minimal 5 karakter.")
          .max(500),
      }),
      req.body,
    );
    const approval = getApprovalForUser(user, Number(req.params.id));
    const result = decideApproval(user, approval.id, "REJECTED", input.note, {
      ip: clientIp(req),
      userAgent: req.headers["user-agent"] ?? "",
    });
    res.json({
      message: "Pengajuan ditolak. Saldo tidak berubah.",
      item: result,
    });
  }),
);
approvalsRouter.patch(
  "/opnames/:id/details/:detailId",
  requirePermission("opnames.create"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const db = getDb();
    const session = db
      .prepare("SELECT department_id FROM stock_opname_sessions WHERE id = ?")
      .get(Number(req.params.id)) as { department_id: number } | undefined;
    if (!session) throw new ApiError(404, "Sesi opname tidak ditemukan.");
    assertDepartmentAccess(user, session.department_id);
    const input = validate(
      z.object({
        physicalQty: z.coerce
          .number()
          .min(0, "Jumlah fisik tidak boleh negatif."),
        reason: z.string().trim().max(500).optional().nullable(),
      }),
      req.body,
    );
    const result = updateOpnameDetail(
      user,
      Number(req.params.id),
      Number(req.params.detailId),
      input,
    );
    res.json(result);
  }),
);
