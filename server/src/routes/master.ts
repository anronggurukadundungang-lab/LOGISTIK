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
import { sanitizeFilename } from "../lib/utils.ts";
import {
  requireAnyPermission,
  requireAuth,
  requirePermission,
} from "../lib/session.ts";
import { assertDepartmentAccess, writeAudit } from "../lib/auth.ts";
export const masterRouter = Router();
masterRouter.use(requireAuth);
masterRouter.get(
  "/meta",
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const db = getDb();
    const departments = db
      .prepare(
        `SELECT d.id, d.code, d.simdondar_code, d.name, d.head_name, d.is_active           FROM departments d          ${user.allDepartments ? "" : "JOIN user_departments ud ON ud.department_id = d.id AND ud.user_id = ?"}          ORDER BY d.name`,
      )
      .all(...(user.allDepartments ? [] : [user.id]));
    const units = db
      .prepare("SELECT id, code, name, is_active FROM units ORDER BY name")
      .all();
    const categories = db
      .prepare("SELECT id, name, is_active FROM item_categories ORDER BY name")
      .all();
    const settings = db
      .prepare(
        "SELECT key, value FROM settings WHERE key IN ('app_name','organization_name','receipt_mode','late_input_days','adjustment_approval_threshold')",
      )
      .all() as Array<{ key: string; value: string }>;
    res.json({
      departments,
      units,
      categories,
      settings: Object.fromEntries(settings.map((row) => [row.key, row.value])),
      today: new Date().toISOString().slice(0, 10),
    });
  }),
);
/* ---------------------------------- BAGIAN ---------------------------------- */ const departmentSchema =
  z.object({
    code: z.string().trim().max(30).optional().nullable(),
    simdondarCode: z.string().trim().max(50).optional().nullable(),
    name: z.string().trim().min(2, "Nama bagian minimal 2 karakter.").max(120),
    headName: z.string().trim().max(120).optional().nullable(),
    isActive: z.boolean().optional(),
  });
masterRouter.get(
  "/departments",
  requirePermission("departments.view"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT d.*, (SELECT COUNT(*) FROM department_stock_balances b WHERE b.department_id = d.id AND b.qty <> 0) AS item_count           FROM departments d          ${user.allDepartments ? "" : "WHERE d.id IN (SELECT department_id FROM user_departments WHERE user_id = ?)"}          ORDER BY d.name`,
      )
      .all(...(user.allDepartments ? [] : [user.id])) as Array<
      Record<string, unknown>
    >;
    res.json({ items: rows });
  }),
);
masterRouter.post(
  "/departments",
  requirePermission("departments.manage"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const input = validate(departmentSchema, req.body);
    const result = withTx((tx) => {
      let code = input.code?.trim();
      if (!code) {
        const last = tx
          .prepare(
            "SELECT code FROM departments WHERE code LIKE 'DEPT-%' ORDER BY code DESC LIMIT 1",
          )
          .get() as { code: string } | undefined;
        const next = last ? Number(last.code.replace("DEPT-", "")) + 1 : 1;
        code = `DEPT-${String(next).padStart(2, "0")}`;
      }
      const now = nowIso();
      const inserted = tx
        .prepare(
          "INSERT INTO departments (code, simdondar_code, name, head_name, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          code,
          input.simdondarCode || null,
          input.name,
          input.headName || null,
          input.isActive === false ? 0 : 1,
          now,
          now,
        );
      const id = Number(inserted.lastInsertRowid);
      const after = tx
        .prepare("SELECT * FROM departments WHERE id = ?")
        .get(id);
      writeAudit(tx, {
        actor: user,
        action: "CREATE_DEPARTMENT",
        entityType: "departments",
        entityId: id,
        after,
        ip: clientIp(req),
        userAgent: req.headers["user-agent"] ?? null,
      });
      return after;
    });
    res.status(201).json({ item: result });
  }),
);
masterRouter.patch(
  "/departments/:id",
  requirePermission("departments.manage"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const id = Number(req.params.id);
    const input = validate(departmentSchema.partial(), req.body);
    const result = withTx((tx) => {
      const before = tx
        .prepare("SELECT * FROM departments WHERE id = ?")
        .get(id) as Record<string, unknown> | undefined;
      if (!before) throw new ApiError(404, "Bagian tidak ditemukan.");
      tx.prepare(
        `UPDATE departments SET           code = COALESCE(?, code),           simdondar_code = ?,           name = COALESCE(?, name),           head_name = ?,           is_active = COALESCE(?, is_active),           updated_at = ?         WHERE id = ?`,
      ).run(
        input.code ?? null,
        input.simdondarCode !== undefined
          ? input.simdondarCode || null
          : (before.simdondar_code as string | null),
        input.name ?? null,
        input.headName !== undefined
          ? input.headName || null
          : (before.head_name as string | null),
        input.isActive === undefined ? null : input.isActive ? 1 : 0,
        nowIso(),
        id,
      );
      const after = tx
        .prepare("SELECT * FROM departments WHERE id = ?")
        .get(id);
      writeAudit(tx, {
        actor: user,
        action: "UPDATE_DEPARTMENT",
        entityType: "departments",
        entityId: id,
        before,
        after,
        ip: clientIp(req),
        userAgent: req.headers["user-agent"] ?? null,
      });
      return after;
    });
    res.json({ item: result });
  }),
);
/* ---------------------------------- BARANG ---------------------------------- */ const itemSchema =
  z.object({
    code: z.string().trim().min(1, "Kode barang wajib diisi.").max(50),
    simdondarCode: z.string().trim().max(60).optional().nullable(),
    name: z.string().trim().min(2, "Nama barang minimal 2 karakter.").max(200),
    categoryId: z.coerce.number().int().positive().nullable().optional(),
    baseUnitId: z.coerce.number().int().positive(),
    minStock: z.coerce.number().min(0).default(0),
    trackBatch: z.boolean().optional(),
    isActive: z.boolean().optional(),
  });
masterRouter.get(
  "/items",
  requirePermission("items.view"),
  asyncHandler(async (req, res) => {
    const page = parsePage(req.query as Record<string, unknown>, 25);
    const search = String(req.query.search ?? "").trim();
    const categoryId = req.query.categoryId
      ? Number(req.query.categoryId)
      : null;
    const activeOnly = req.query.activeOnly === "1";
    const all = req.query.all === "1";
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (search) {
      where.push("(i.code LIKE ? OR i.name LIKE ? OR i.simdondar_code LIKE ?)");
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (categoryId) {
      where.push("i.category_id = ?");
      params.push(categoryId);
    }
    if (activeOnly) where.push("i.is_active = 1");
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const db = getDb();
    const baseSelect = `SELECT i.*, c.name AS category_name, u.code AS unit_code, u.name AS unit_name                          FROM items i                          LEFT JOIN item_categories c ON c.id = i.category_id                          JOIN units u ON u.id = i.base_unit_id                          ${whereSql}`;
    if (all) {
      const items = db.prepare(`${baseSelect} ORDER BY i.name`).all(...params);
      res.json({ items });
      return;
    }
    const total = Number(
      (
        db
          .prepare(`SELECT COUNT(*) AS total FROM items i ${whereSql}`)
          .get(...params) as { total: number }
      ).total,
    );
    const items = db
      .prepare(`${baseSelect} ORDER BY i.name LIMIT ? OFFSET ?`)
      .all(...params, page.pageSize, page.offset);
    res.json(paginated(items, total, page));
  }),
);
masterRouter.post(
  "/items",
  requirePermission("items.manage"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const input = validate(itemSchema, req.body);
    const result = withTx((tx) => {
      const now = nowIso();
      const inserted = tx
        .prepare(
          `INSERT INTO items (code, simdondar_code, name, category_id, base_unit_id, min_stock, track_batch, is_active, created_at, updated_at)           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.code,
          input.simdondarCode || null,
          input.name,
          input.categoryId ?? null,
          input.baseUnitId,
          input.minStock,
          input.trackBatch ? 1 : 0,
          input.isActive === false ? 0 : 1,
          now,
          now,
        );
      const id = Number(inserted.lastInsertRowid);
      const after = tx.prepare("SELECT * FROM items WHERE id = ?").get(id);
      writeAudit(tx, {
        actor: user,
        action: "CREATE_ITEM",
        entityType: "items",
        entityId: id,
        after,
        ip: clientIp(req),
        userAgent: req.headers["user-agent"] ?? null,
      });
      return after;
    });
    res.status(201).json({ item: result });
  }),
);
masterRouter.patch(
  "/items/:id",
  requirePermission("items.manage"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const id = Number(req.params.id);
    const input = validate(itemSchema.partial(), req.body);
    const result = withTx((tx) => {
      const before = tx.prepare("SELECT * FROM items WHERE id = ?").get(id) as
        | Record<string, unknown>
        | undefined;
      if (!before) throw new ApiError(404, "Barang tidak ditemukan.");
      tx.prepare(
        `UPDATE items SET           code = COALESCE(?, code), simdondar_code = ?, name = COALESCE(?, name),           category_id = COALESCE(?, category_id), base_unit_id = COALESCE(?, base_unit_id),           min_stock = COALESCE(?, min_stock), track_batch = COALESCE(?, track_batch),           is_active = COALESCE(?, is_active), updated_at = ?         WHERE id = ?`,
      ).run(
        input.code ?? null,
        input.simdondarCode !== undefined
          ? input.simdondarCode || null
          : (before.simdondar_code as string | null),
        input.name ?? null,
        input.categoryId ?? null,
        input.baseUnitId ?? null,
        input.minStock ?? null,
        input.trackBatch === undefined ? null : input.trackBatch ? 1 : 0,
        input.isActive === undefined ? null : input.isActive ? 1 : 0,
        nowIso(),
        id,
      );
      const after = tx.prepare("SELECT * FROM items WHERE id = ?").get(id);
      writeAudit(tx, {
        actor: user,
        action: "UPDATE_ITEM",
        entityType: "items",
        entityId: id,
        before,
        after,
        ip: clientIp(req),
        userAgent: req.headers["user-agent"] ?? null,
      });
      return after;
    });
    res.json({ item: result });
  }),
);
/* ------------------------------ KATEGORI / SATUAN ------------------------------ */ masterRouter.post(
  "/categories",
  requirePermission("items.manage"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const input = validate(
      z.object({ name: z.string().trim().min(2).max(80) }),
      req.body,
    );
    const result = withTx((tx) => {
      const inserted = tx
        .prepare("INSERT INTO item_categories (name, created_at) VALUES (?, ?)")
        .run(input.name, nowIso());
      const id = Number(inserted.lastInsertRowid);
      writeAudit(tx, {
        actor: user,
        action: "CREATE_CATEGORY",
        entityType: "item_categories",
        entityId: id,
        after: { name: input.name },
      });
      return tx.prepare("SELECT * FROM item_categories WHERE id = ?").get(id);
    });
    res.status(201).json({ item: result });
  }),
);
masterRouter.patch(
  "/categories/:id",
  requirePermission("items.manage"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const id = Number(req.params.id);
    const input = validate(
      z.object({
        name: z.string().trim().min(2).max(80).optional(),
        isActive: z.boolean().optional(),
      }),
      req.body,
    );
    const result = withTx((tx) => {
      const before = tx
        .prepare("SELECT * FROM item_categories WHERE id = ?")
        .get(id) as Record<string, unknown> | undefined;
      if (!before) throw new ApiError(404, "Kategori tidak ditemukan.");
      tx.prepare(
        "UPDATE item_categories SET name = COALESCE(?, name), is_active = COALESCE(?, is_active) WHERE id = ?",
      ).run(
        input.name ?? null,
        input.isActive === undefined ? null : input.isActive ? 1 : 0,
        id,
      );
      const after = tx
        .prepare("SELECT * FROM item_categories WHERE id = ?")
        .get(id);
      writeAudit(tx, {
        actor: user,
        action: "UPDATE_CATEGORY",
        entityType: "item_categories",
        entityId: id,
        before,
        after,
      });
      return after;
    });
    res.json({ item: result });
  }),
);
masterRouter.post(
  "/units",
  requirePermission("items.manage"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const input = validate(
      z.object({
        code: z.string().trim().min(1).max(20),
        name: z.string().trim().min(1).max(50),
      }),
      req.body,
    );
    const result = withTx((tx) => {
      const inserted = tx
        .prepare("INSERT INTO units (code, name, created_at) VALUES (?, ?, ?)")
        .run(input.code.toUpperCase(), input.name, nowIso());
      const id = Number(inserted.lastInsertRowid);
      writeAudit(tx, {
        actor: user,
        action: "CREATE_UNIT",
        entityType: "units",
        entityId: id,
        after: input,
      });
      return tx.prepare("SELECT * FROM units WHERE id = ?").get(id);
    });
    res.status(201).json({ item: result });
  }),
);
masterRouter.patch(
  "/units/:id",
  requirePermission("items.manage"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const id = Number(req.params.id);
    const input = validate(
      z.object({
        name: z.string().trim().min(1).max(50).optional(),
        isActive: z.boolean().optional(),
      }),
      req.body,
    );
    const result = withTx((tx) => {
      const before = tx.prepare("SELECT * FROM units WHERE id = ?").get(id) as
        | Record<string, unknown>
        | undefined;
      if (!before) throw new ApiError(404, "Satuan tidak ditemukan.");
      tx.prepare(
        "UPDATE units SET name = COALESCE(?, name), is_active = COALESCE(?, is_active) WHERE id = ?",
      ).run(
        input.name ?? null,
        input.isActive === undefined ? null : input.isActive ? 1 : 0,
        id,
      );
      const after = tx.prepare("SELECT * FROM units WHERE id = ?").get(id);
      writeAudit(tx, {
        actor: user,
        action: "UPDATE_UNIT",
        entityType: "units",
        entityId: id,
        before,
        after,
      });
      return after;
    });
    res.json({ item: result });
  }),
);
masterRouter.get(
  "/items/:id/conversions",
  requirePermission("items.view"),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT c.*, u.code AS unit_code, u.name AS unit_name FROM item_unit_conversions c           JOIN units u ON u.id = c.from_unit_id WHERE c.item_id = ? ORDER BY u.name`,
      )
      .all(Number(req.params.id));
    res.json({ items: rows });
  }),
);
masterRouter.post(
  "/items/:id/conversions",
  requirePermission("items.manage"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const itemId = Number(req.params.id);
    const input = validate(
      z.object({
        fromUnitId: z.coerce.number().int().positive(),
        factor: z.coerce.number().positive(),
      }),
      req.body,
    );
    const result = withTx((tx) => {
      const item = tx
        .prepare("SELECT base_unit_id FROM items WHERE id = ?")
        .get(itemId) as { base_unit_id: number } | undefined;
      if (!item) throw new ApiError(404, "Barang tidak ditemukan.");
      if (item.base_unit_id === input.fromUnitId) {
        throw new ApiError(
          422,
          "Satuan sumber tidak boleh sama dengan satuan dasar.",
        );
      }
      const inserted = tx
        .prepare(
          "INSERT INTO item_unit_conversions (item_id, from_unit_id, factor, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(itemId, input.fromUnitId, input.factor, nowIso());
      const id = Number(inserted.lastInsertRowid);
      writeAudit(tx, {
        actor: user,
        action: "CREATE_UNIT_CONVERSION",
        entityType: "items",
        entityId: itemId,
        after: input,
      });
      return tx
        .prepare(
          `SELECT c.*, u.code AS unit_code FROM item_unit_conversions c JOIN units u ON u.id = c.from_unit_id WHERE c.id = ?`,
        )
        .get(id);
    });
    res.status(201).json({ item: result });
  }),
);
masterRouter.delete(
  "/items/:id/conversions/:conversionId",
  requirePermission("items.manage"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const itemId = Number(req.params.id);
    const conversionId = Number(req.params.conversionId);
    withTx((tx) => {
      const before = tx
        .prepare(
          "SELECT * FROM item_unit_conversions WHERE id = ? AND item_id = ?",
        )
        .get(conversionId, itemId);
      if (!before) throw new ApiError(404, "Konversi tidak ditemukan.");
      tx.prepare("DELETE FROM item_unit_conversions WHERE id = ?").run(
        conversionId,
      );
      writeAudit(tx, {
        actor: user,
        action: "DELETE_UNIT_CONVERSION",
        entityType: "items",
        entityId: itemId,
        before,
      });
    });
    res.json({ ok: true });
  }),
);
masterRouter.get(
  "/search/items",
  requireAnyPermission(["items.view", "stocks.view"]),
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT i.id, i.code, i.name, i.base_unit_id, u.code AS unit_code           FROM items i JOIN units u ON u.id = i.base_unit_id          WHERE i.is_active = 1 AND (? = '' OR i.code LIKE ? OR i.name LIKE ?)          ORDER BY i.name LIMIT 30`,
      )
      .all(q, `%${q}%`, `%${q}%`);
    res.json({ items: rows });
  }),
);
masterRouter.get(
  "/departments/mapped-unmapped",
  requirePermission("departments.manage"),
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT d.id, d.code, d.name, d.simdondar_code           FROM departments d ORDER BY d.name`,
      )
      .all();
    res.json({ items: rows });
  }),
);
masterRouter.get("/export-filename-hint", (_req, res) => {
  res.json({ hint: sanitizeFilename("laporan") });
});
