import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db.ts";
import { asyncHandler } from "../lib/http.ts";
import { daysBetween, parseDateToIso, todayLocal } from "../lib/utils.ts";
import { requirePermission } from "../lib/session.ts";
import { assertDepartmentAccess, hasPermission } from "../lib/auth.ts";
export const dashboardRouter = Router();
const filterSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  itemId: z.coerce.number().int().positive().optional(),
});
dashboardRouter.get(
  "/dashboard",
  requirePermission("dashboard.view"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const input = filterSchema.parse(req.query);
    if (input.departmentId) assertDepartmentAccess(user, input.departmentId);
    const today = todayLocal();
    const defaultFrom = `${today.slice(0, 7)}-01`;
    const from = parseDateToIso(input.from) ?? defaultFrom;
    const to = parseDateToIso(input.to) ?? today;
    const db = getDb();
    const scopeParams: number[] = [];
    let scopeSql = "";
    if (!user.allDepartments) {
      if (!user.departmentIds.length) {
        res.json({
          empty: true,
          message: "Akun Anda belum ditugaskan ke bagian mana pun.",
        });
        return;
      }
      scopeSql = ` AND e.department_id IN (${user.departmentIds.map(() => "?").join(",")})`;
      scopeParams.push(...user.departmentIds);
    }
    if (input.departmentId) {
      scopeSql += " AND e.department_id = ?";
      scopeParams.push(input.departmentId);
    }
    const balScopeParams: number[] = [];
    let balScopeSql = "";
    if (!user.allDepartments) {
      balScopeSql = ` AND b.department_id IN (${user.departmentIds.map(() => "?").join(",")})`;
      balScopeParams.push(...user.departmentIds);
    }
    if (input.departmentId) {
      balScopeSql += " AND b.department_id = ?";
      balScopeParams.push(input.departmentId);
    }
    const itemFilter = (alias: string) => {
      const conditions: string[] = [];
      const params: number[] = [];
      if (input.categoryId) {
        conditions.push(`${alias}.category_id = ?`);
        params.push(input.categoryId);
      }
      if (input.itemId) {
        conditions.push(`${alias}.id = ?`);
        params.push(input.itemId);
      }
      return {
        sql: conditions.length ? ` AND ${conditions.join(" AND ")}` : "",
        params,
      };
    };
    const balItem = itemFilter("i");
    const entryItem = itemFilter("i");
    const cards = db
      .prepare(
        `SELECT          (SELECT COUNT(*) FROM items WHERE is_active = 1) AS active_items,          (SELECT COUNT(*) FROM departments WHERE is_active = 1            ${user.allDepartments ? "" : `AND id IN (${user.departmentIds.map(() => "?").join(",") || "NULL"})`}            ${input.departmentId ? "AND id = ?" : ""}) AS department_count,          (SELECT COALESCE(SUM(b.qty), 0) FROM department_stock_balances b             JOIN items i ON i.id = b.item_id            WHERE 1=1 ${balScopeSql}${balItem.sql}) AS total_stock,          (SELECT COUNT(*) FROM department_stock_balances b JOIN items i ON i.id = b.item_id            WHERE b.qty > 0 AND b.qty <= i.min_stock ${balScopeSql}${balItem.sql}) AS low_stock_count,          (SELECT COUNT(*) FROM department_stock_balances b JOIN items i ON i.id = b.item_id            WHERE b.qty <= 0 ${balScopeSql}${balItem.sql}) AS critical_stock_count,          (SELECT COUNT(*) FROM approval_requests a WHERE a.status = 'PENDING'            ${user.allDepartments ? "" : `AND a.department_id IN (${user.departmentIds.map(() => "?").join(",") || "NULL"})`}            ${input.departmentId ? "AND a.department_id = ?" : ""}) AS pending_approvals,          (SELECT COUNT(*) FROM simdondar_transactions t WHERE t.status = 'AWAITING_RECEIPT'            ${user.allDepartments ? "" : `AND t.department_id IN (${user.departmentIds.map(() => "?").join(",") || "NULL"})`}            ${input.departmentId ? "AND t.department_id = ?" : ""}) AS awaiting_receipts`,
      )
      .get(
        ...(user.allDepartments ? [] : user.departmentIds),
        ...(input.departmentId ? [input.departmentId] : []),
        ...balScopeParams,
        ...balItem.params,
        ...balScopeParams,
        ...balItem.params,
        ...balScopeParams,
        ...balItem.params,
        ...(user.allDepartments ? [] : user.departmentIds),
        ...(input.departmentId ? [input.departmentId] : []),
        ...(user.allDepartments ? [] : user.departmentIds),
        ...(input.departmentId ? [input.departmentId] : []),
      ) as Record<string, number>;
    const consumptionParams = [...scopeParams, ...entryItem.params];
    const consumption = db
      .prepare(
        `SELECT COALESCE(SUM(CASE                  WHEN e.entry_type = 'CONSUMPTION' THEN -e.qty_delta                  WHEN e.entry_type = 'REVERSAL' AND o.entry_type = 'CONSUMPTION' THEN -e.qty_delta                  ELSE 0 END), 0) AS qty,                COUNT(CASE WHEN e.entry_type = 'CONSUMPTION' THEN 1 END) AS trx_count           FROM stock_entries e           JOIN items i ON i.id = e.item_id           LEFT JOIN stock_entries o ON o.id = e.reversed_entry_id          WHERE e.occurred_at BETWEEN ? AND ? ${scopeSql}${entryItem.sql}`,
      )
      .get(from, to, ...consumptionParams) as {
      qty: number;
      trx_count: number;
    };
    const issued = db
      .prepare(
        `SELECT COALESCE(SUM(t.qty_issued), 0) AS qty, COUNT(*) AS trx_count           FROM simdondar_transactions t          WHERE t.status <> 'CANCELLED' AND t.source_date BETWEEN ? AND ?            ${user.allDepartments ? "" : `AND t.department_id IN (${user.departmentIds.map(() => "?").join(",") || "NULL"})`}            ${input.departmentId ? "AND t.department_id = ?" : ""}`,
      )
      .get(
        from,
        to,
        ...(user.allDepartments ? [] : user.departmentIds),
        ...(input.departmentId ? [input.departmentId] : []),
      ) as { qty: number; trx_count: number };
    const days = Math.max(1, daysBetween(from, to));
    const trend = db
      .prepare(
        `SELECT substr(e.occurred_at, 1, ${days > 62 ? 7 : 10}) AS period,                ROUND(SUM(CASE                  WHEN e.entry_type = 'CONSUMPTION' THEN -e.qty_delta                  WHEN e.entry_type = 'REVERSAL' AND o.entry_type = 'CONSUMPTION' THEN -e.qty_delta                  ELSE 0 END), 3) AS qty           FROM stock_entries e JOIN items i ON i.id = e.item_id           LEFT JOIN stock_entries o ON o.id = e.reversed_entry_id          WHERE e.occurred_at BETWEEN ? AND ? ${scopeSql}${entryItem.sql}          GROUP BY period ORDER BY period`,
      )
      .all(from, to, ...consumptionParams);
    const topItems = db
      .prepare(
        `SELECT i.id, i.name AS item_name, i.code AS item_code, u.code AS unit_code,                ROUND(SUM(CASE                  WHEN e.entry_type = 'CONSUMPTION' THEN -e.qty_delta                  WHEN e.entry_type = 'REVERSAL' AND o.entry_type = 'CONSUMPTION' THEN -e.qty_delta                  ELSE 0 END), 3) AS qty           FROM stock_entries e JOIN items i ON i.id = e.item_id           JOIN units u ON u.id = i.base_unit_id           LEFT JOIN stock_entries o ON o.id = e.reversed_entry_id          WHERE e.occurred_at BETWEEN ? AND ? ${scopeSql}${entryItem.sql}          GROUP BY i.id, i.name, i.code, u.code HAVING SUM(CASE                  WHEN e.entry_type = 'CONSUMPTION' THEN -e.qty_delta                  WHEN e.entry_type = 'REVERSAL' AND o.entry_type = 'CONSUMPTION' THEN -e.qty_delta                  ELSE 0 END) > 0 ORDER BY qty DESC LIMIT 8`,
      )
      .all(from, to, ...consumptionParams);
    const stockByDepartment = db
      .prepare(
        `SELECT d.id, d.name AS department_name, ROUND(COALESCE(SUM(b.qty), 0), 3) AS qty           FROM departments d           LEFT JOIN department_stock_balances b ON b.department_id = d.id           LEFT JOIN items i ON i.id = b.item_id AND 1=1 ${balItem.sql}          WHERE d.is_active = 1            ${user.allDepartments ? "" : `AND d.id IN (${user.departmentIds.map(() => "?").join(",") || "NULL"})`}            ${input.departmentId ? "AND d.id = ?" : ""}          GROUP BY d.id ORDER BY qty DESC`,
      )
      .all(
        ...balItem.params,
        ...(user.allDepartments ? [] : user.departmentIds),
        ...(input.departmentId ? [input.departmentId] : []),
      );
    const issuesByDepartment = db
      .prepare(
        `SELECT d.id, d.name AS department_name, ROUND(COALESCE(SUM(t.qty_issued), 0), 3) AS qty           FROM departments d           LEFT JOIN simdondar_transactions t ON t.department_id = d.id AND t.source_date BETWEEN ? AND ?           WHERE d.is_active = 1             ${user.allDepartments ? "" : `AND d.id IN (${user.departmentIds.map(() => "?").join(",") || "NULL"})`}             ${input.departmentId ? "AND d.id = ?" : ""}           GROUP BY d.id ORDER BY qty DESC`,
      )
      .all(
        from,
        to,
        ...(user.allDepartments ? [] : user.departmentIds),
        ...(input.departmentId ? [input.departmentId] : []),
      );
    const lowStock = db
      .prepare(
        `SELECT b.qty, i.name AS item_name, i.code AS item_code, i.min_stock, u.code AS unit_code,                d.name AS department_name, d.id AS department_id, i.id AS item_id           FROM department_stock_balances b           JOIN items i ON i.id = b.item_id           JOIN departments d ON d.id = b.department_id           JOIN units u ON u.id = i.base_unit_id          WHERE b.qty <= i.min_stock ${balScopeSql}${balItem.sql}          ORDER BY (b.qty - i.min_stock) ASC LIMIT 15`,
      )
      .all(...balScopeParams, ...balItem.params);
    const lateInput = db
      .prepare(
        `SELECT d.id, d.name AS department_name,                (SELECT MAX(e.occurred_at) FROM stock_entries e                  WHERE e.department_id = d.id AND e.entry_type = 'CONSUMPTION') AS last_input,                (SELECT COUNT(*) FROM simdondar_transactions t                  WHERE t.department_id = d.id AND t.status <> 'CANCELLED' AND t.source_date BETWEEN ? AND ?) AS receipt_count           FROM departments d          WHERE d.is_active = 1            ${user.allDepartments ? "" : `AND d.id IN (${user.departmentIds.map(() => "?").join(",") || "NULL"})`}            ${input.departmentId ? "AND d.id = ?" : ""}          ORDER BY last_input ASC`,
      )
      .all(
        from,
        to,
        ...(user.allDepartments ? [] : user.departmentIds),
        ...(input.departmentId ? [input.departmentId] : []),
      ) as Array<{
      id: number;
      department_name: string;
      last_input: string | null;
      receipt_count: number;
    }>;
    const opnames = db
      .prepare(
        `SELECT s.id, s.opname_date, s.status, d.name AS department_name,                (SELECT COUNT(*) FROM stock_opname_details od WHERE od.session_id = s.id                  AND ABS(COALESCE(od.difference, 0)) > 0.0001) AS diff_count,                (SELECT COALESCE(SUM(ABS(od.difference)), 0) FROM stock_opname_details od                  WHERE od.session_id = s.id AND ABS(COALESCE(od.difference, 0)) > 0.0001) AS diff_qty           FROM stock_opname_sessions s JOIN departments d ON d.id = s.department_id          WHERE s.status IN ('SUBMITTED','APPROVED','REJECTED')            ${user.allDepartments ? "" : `AND s.department_id IN (${user.departmentIds.map(() => "?").join(",") || "NULL"})`}            ${input.departmentId ? "AND s.department_id = ?" : ""}          ORDER BY s.opname_date DESC, s.id DESC LIMIT 6`,
      )
      .all(
        ...(user.allDepartments ? [] : user.departmentIds),
        ...(input.departmentId ? [input.departmentId] : []),
      );
    const pending = db
      .prepare(
        `SELECT a.id, a.type, a.summary, a.created_at, a.status, d.name AS department_name, u.name AS requester_name           FROM approval_requests a JOIN departments d ON d.id = a.department_id           JOIN users u ON u.id = a.requested_by          WHERE a.status = 'PENDING'            ${user.allDepartments ? "" : `AND a.department_id IN (${user.departmentIds.map(() => "?").join(",") || "NULL"})`}            ${input.departmentId ? "AND a.department_id = ?" : ""}          ORDER BY a.created_at DESC LIMIT 8`,
      )
      .all(
        ...(user.allDepartments ? [] : user.departmentIds),
        ...(input.departmentId ? [input.departmentId] : []),
      );
    const recentImports = hasPermission(user, "imports.view")
      ? db
          .prepare(
            `SELECT b.id, b.filename, b.status, b.total_rows, b.imported_rows, b.error_rows, b.duplicate_rows,                    b.created_at, u.name AS created_by_name               FROM simdondar_import_batches b JOIN users u ON u.id = b.created_by              ORDER BY b.created_at DESC LIMIT 5`,
          )
          .all()
      : [];
    const recentEntries = db
      .prepare(
        `SELECT e.id, e.entry_no, e.entry_type, e.qty_delta, e.occurred_at, e.balance_after,                i.name AS item_name, u.code AS unit_code, d.name AS department_name, us.name AS created_by_name           FROM stock_entries e JOIN items i ON i.id = e.item_id JOIN units u ON u.id = e.unit_id           JOIN departments d ON d.id = e.department_id JOIN users us ON us.id = e.created_by          WHERE 1=1 ${scopeSql}          ORDER BY e.created_at DESC LIMIT 8`,
      )
      .all(...scopeParams);
    res.json({
      filters: {
        from,
        to,
        departmentId: input.departmentId ?? null,
        categoryId: input.categoryId ?? null,
        itemId: input.itemId ?? null,
      },
      cards: {
        ...cards,
        consumption_qty: consumption.qty,
        consumption_trx: consumption.trx_count,
        issued_qty: issued.qty,
        issued_trx: issued.trx_count,
        scope_all: user.allDepartments,
      },
      charts: { trend, topItems, stockByDepartment, issuesByDepartment },
      tables: {
        lowStock,
        lateInput,
        opnames,
        pending,
        recentImports,
        recentEntries,
      },
    });
  }),
);
