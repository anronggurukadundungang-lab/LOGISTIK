import { Router } from "express";
import { z } from "zod";
import { getDb, nowIso, withTx } from "../db.ts";
import { ApiError, asyncHandler, clientIp, validate } from "../lib/http.ts";
import { hashPassword, passwordIssue, randomToken } from "../lib/password.ts";
import { requireAuth, requirePermission } from "../lib/session.ts";
import { writeAudit } from "../lib/auth.ts";
export const usersRouter = Router();
usersRouter.use(requireAuth);
usersRouter.get(
  "/roles",
  requirePermission("users.manage"),
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const roles = db
      .prepare(
        `SELECT r.id, r.code, r.name, r.description,                (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count           FROM roles r ORDER BY r.id`,
      )
      .all();
    res.json({ items: roles });
  }),
);
usersRouter.get(
  "/users",
  requirePermission("users.manage"),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const search = String(req.query.search ?? "").trim();
    const rows = db
      .prepare(
        `SELECT u.id, u.username, u.name, u.email, u.is_active, u.must_change_password,                u.last_login_at, u.created_at, r.code AS role_code, r.name AS role_name,                (SELECT GROUP_CONCAT(d.name, ', ') FROM user_departments ud                   JOIN departments d ON d.id = ud.department_id WHERE ud.user_id = u.id) AS departments,                (SELECT GROUP_CONCAT(d.id) FROM user_departments ud                   JOIN departments d ON d.id = ud.department_id WHERE ud.user_id = u.id) AS department_ids           FROM users u JOIN roles r ON r.id = u.role_id          WHERE (? = '' OR u.username LIKE ? OR u.name LIKE ?)          ORDER BY u.name`,
      )
      .all(search, `%${search}%`, `%${search}%`) as Array<
      Record<string, unknown>
    >;
    res.json({
      items: rows.map((row) => ({
        ...row,
        departmentIds: row.department_ids
          ? String(row.department_ids)
              .split(",")
              .map((id) => Number(id))
          : [],
      })),
    });
  }),
);
const userCreateSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Nama pengguna minimal 3 karakter.")
    .max(50)
    .regex(
      /^[a-zA-Z0-9._-]+$/,
      "Nama pengguna hanya boleh huruf, angka, titik, garis bawah, dan strip.",
    ),
  name: z.string().trim().min(2, "Nama lengkap wajib diisi.").max(120),
  email: z
    .string()
    .trim()
    .email("Format email tidak valid.")
    .optional()
    .nullable()
    .or(z.literal("")),
  password: z.string().min(8, "Kata sandi minimal 8 karakter."),
  roleId: z.coerce.number().int().positive(),
  departmentIds: z.array(z.coerce.number().int().positive()).default([]),
});
function assertDepartmentsRequired(
  tx: ReturnType<typeof getDb>,
  roleId: number,
  departmentIds: number[],
): void {
  const role = tx.prepare("SELECT code FROM roles WHERE id = ?").get(roleId) as
    | { code: string }
    | undefined;
  if (!role) throw new ApiError(422, "Role tidak ditemukan.");
  if (
    ["KEPALA_BAGIAN", "PIC"].includes(role.code) &&
    departmentIds.length === 0
  ) {
    throw new ApiError(
      422,
      "Role Kepala Bagian/PIC wajib memiliki minimal satu bagian.",
    );
  }
  for (const departmentId of departmentIds) {
    const dept = tx
      .prepare("SELECT id FROM departments WHERE id = ?")
      .get(departmentId);
    if (!dept) throw new ApiError(422, "Bagian yang dipilih tidak ditemukan.");
  }
}
usersRouter.post(
  "/users",
  requirePermission("users.manage"),
  asyncHandler(async (req, res) => {
    const actor = req.user!;
    const input = validate(userCreateSchema, req.body);
    const issue = passwordIssue(input.password);
    if (issue) throw new ApiError(422, issue);
    const result = withTx((tx) => {
      assertDepartmentsRequired(tx, input.roleId, input.departmentIds);
      const now = nowIso();
      const inserted = tx
        .prepare(
          `INSERT INTO users (username, name, email, password_hash, role_id, is_active, must_change_password, created_at, updated_at)           VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)`,
        )
        .run(
          input.username,
          input.name,
          input.email || null,
          hashPassword(input.password),
          input.roleId,
          now,
          now,
        );
      const id = Number(inserted.lastInsertRowid);
      for (const departmentId of [...new Set(input.departmentIds)]) {
        tx.prepare(
          "INSERT INTO user_departments (user_id, department_id) VALUES (?, ?)",
        ).run(id, departmentId);
      }
      const after = tx
        .prepare(
          `SELECT u.id, u.username, u.name, u.email, u.is_active, r.code AS role_code FROM users u             JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
        )
        .get(id);
      writeAudit(tx, {
        actor,
        action: "CREATE_USER",
        entityType: "users",
        entityId: id,
        after: { ...(after as object), departmentIds: input.departmentIds },
        ip: clientIp(req),
        userAgent: req.headers["user-agent"] ?? null,
      });
      return after;
    });
    res.status(201).json({ item: result });
  }),
);
const userUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: z
    .string()
    .trim()
    .email("Format email tidak valid.")
    .optional()
    .nullable()
    .or(z.literal("")),
  roleId: z.coerce.number().int().positive().optional(),
  isActive: z.boolean().optional(),
  departmentIds: z.array(z.coerce.number().int().positive()).optional(),
});
usersRouter.patch(
  "/users/:id",
  requirePermission("users.manage"),
  asyncHandler(async (req, res) => {
    const actor = req.user!;
    const id = Number(req.params.id);
    const input = validate(userUpdateSchema, req.body);
    const result = withTx((tx) => {
      const before = tx
        .prepare(
          `SELECT u.*, (SELECT GROUP_CONCAT(department_id) FROM user_departments WHERE user_id = u.id) AS dept_ids             FROM users u WHERE u.id = ?`,
        )
        .get(id) as Record<string, unknown> | undefined;
      if (!before) throw new ApiError(404, "Pengguna tidak ditemukan.");
      if (id === actor.id && input.isActive === false) {
        throw new ApiError(422, "Anda tidak dapat menonaktifkan akun sendiri.");
      }
      const roleId = input.roleId ?? (before.role_id as number);
      const departmentIds =
        input.departmentIds ??
        (before.dept_ids
          ? String(before.dept_ids)
              .split(",")
              .map((value) => Number(value))
          : []);
      assertDepartmentsRequired(tx, roleId, departmentIds);
      const activeSuperAdmins = Number(
        (
          tx
            .prepare(
              `SELECT COUNT(*) AS count FROM users u JOIN roles r ON r.id = u.role_id                WHERE r.code = 'SUPER_ADMIN' AND u.is_active = 1`,
            )
            .get() as { count: number }
        ).count,
      );
      const beforeRole = tx
        .prepare("SELECT code FROM roles WHERE id = ?")
        .get(before.role_id as number) as { code: string };
      if (
        beforeRole.code === "SUPER_ADMIN" &&
        activeSuperAdmins <= 1 &&
        (input.isActive === false ||
          (input.roleId && input.roleId !== before.role_id))
      ) {
        throw new ApiError(422, "Minimal harus ada satu administrator aktif.");
      }
      tx.prepare(
        `UPDATE users SET name = COALESCE(?, name), email = ?, role_id = COALESCE(?, role_id),          is_active = COALESCE(?, is_active), updated_at = ? WHERE id = ?`,
      ).run(
        input.name ?? null,
        input.email !== undefined
          ? input.email || null
          : (before.email as string | null),
        input.roleId ?? null,
        input.isActive === undefined ? null : input.isActive ? 1 : 0,
        nowIso(),
        id,
      );
      if (input.departmentIds) {
        tx.prepare("DELETE FROM user_departments WHERE user_id = ?").run(id);
        for (const departmentId of [...new Set(input.departmentIds)]) {
          tx.prepare(
            "INSERT INTO user_departments (user_id, department_id) VALUES (?, ?)",
          ).run(id, departmentId);
        }
      }
      if (input.isActive === false) {
        tx.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
      }
      const after = tx
        .prepare(
          `SELECT u.id, u.username, u.name, u.email, u.is_active, u.role_id,                  (SELECT GROUP_CONCAT(department_id) FROM user_departments WHERE user_id = u.id) AS dept_ids             FROM users u WHERE u.id = ?`,
        )
        .get(id);
      writeAudit(tx, {
        actor,
        action: "UPDATE_USER",
        entityType: "users",
        entityId: id,
        before: { ...before, password_hash: undefined },
        after,
        ip: clientIp(req),
        userAgent: req.headers["user-agent"] ?? null,
      });
      return after;
    });
    res.json({ item: result });
  }),
);
usersRouter.post(
  "/users/:id/reset-password",
  requirePermission("users.manage"),
  asyncHandler(async (req, res) => {
    const actor = req.user!;
    const id = Number(req.params.id);
    const input = validate(
      z.object({ newPassword: z.string().min(8).optional() }),
      req.body ?? {},
    );
    const temporaryPassword = input.newPassword ?? `Stok-${randomToken(6)}`;
    const result = withTx((tx) => {
      const target = tx
        .prepare("SELECT id, name, username FROM users WHERE id = ?")
        .get(id) as { id: number; name: string; username: string } | undefined;
      if (!target) throw new ApiError(404, "Pengguna tidak ditemukan.");
      tx.prepare(
        "UPDATE users SET password_hash = ?, must_change_password = 1, failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?",
      ).run(hashPassword(temporaryPassword), nowIso(), id);
      tx.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
      writeAudit(tx, {
        actor,
        action: "RESET_PASSWORD",
        entityType: "users",
        entityId: id,
        after: { username: target.username, mustChangePassword: true },
        ip: clientIp(req),
        userAgent: req.headers["user-agent"] ?? null,
      });
      return { temporaryPassword };
    });
    res.json({
      ...result,
      message: "Kata sandi direset. Pengguna wajib menggantinya saat login.",
    });
  }),
);
