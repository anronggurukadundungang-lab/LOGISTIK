import { Router } from "express";
import { z } from "zod";
import { getDb, nowIso } from "../db.ts";
import { asyncHandler, clientIp, validate, ApiError } from "../lib/http.ts";
import {
  hashPassword,
  passwordIssue,
  sha256,
  verifyPassword,
} from "../lib/password.ts";
import { loadUserBySession, writeAudit } from "../lib/auth.ts";
import {
  checkLoginRateLimit,
  clearSessionCookie,
  createSession,
  destroySession,
  requireAuth,
  resetLoginRateLimit,
  setSessionCookie,
  userPayload,
} from "../lib/session.ts";
export const authRouter = Router();
const loginSchema = z.object({
  username: z.string().trim().min(1, "Nama pengguna wajib diisi."),
  password: z.string().min(1, "Kata sandi wajib diisi."),
});
authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    checkLoginRateLimit(req);
    const input = validate(loginSchema, req.body);
    const db = getDb();
    const user = db
      .prepare(
        `SELECT u.*, r.code AS role_code, r.name AS role_name FROM users u           JOIN roles r ON r.id = u.role_id WHERE u.username = ?`,
      )
      .get(input.username) as
      | {
          id: number;
          username: string;
          name: string;
          password_hash: string;
          is_active: number;
          role_code: string;
          role_name: string;
          failed_login_count: number;
          locked_until: string | null;
          must_change_password: number;
        }
      | undefined;
    if (!user) {
      throw new ApiError(401, "Nama pengguna atau kata sandi salah.");
    }
    if (!user.is_active) {
      throw new ApiError(403, "Akun ini dinonaktifkan. Hubungi administrator.");
    }
    if (
      user.locked_until &&
      new Date(user.locked_until).getTime() > Date.now()
    ) {
      throw new ApiError(
        429,
        "Akun terkunci sementara karena percobaan login gagal. Coba lagi beberapa saat lagi.",
      );
    }
    if (!verifyPassword(input.password, user.password_hash)) {
      const failed = user.failed_login_count + 1;
      const lockedUntil =
        failed >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
      db.prepare(
        "UPDATE users SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE id = ?",
      ).run(lockedUntil ? 0 : failed, lockedUntil, nowIso(), user.id);
      throw new ApiError(401, "Nama pengguna atau kata sandi salah.");
    }
    db.prepare(
      "UPDATE users SET last_login_at = ?, failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?",
    ).run(nowIso(), nowIso(), user.id);
    const session = createSession(user.id, req);
    setSessionCookie(res, session.token, session.expiresAt);
    resetLoginRateLimit(req);
    const loaded = loadUserBySession(sha256(session.token));
    if (!loaded || loaded.id !== user.id)
      throw new ApiError(500, "Gagal membuat sesi.");
    writeAudit(db, {
      actor: loaded,
      action: "LOGIN",
      entityType: "users",
      entityId: user.id,
      ip: clientIp(req),
      userAgent: req.headers["user-agent"] ?? null,
    });
    res.json({ user: userPayload(loaded) });
  }),
);
authRouter.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    writeAudit(getDb(), {
      actor: user,
      action: "LOGOUT",
      entityType: "users",
      entityId: user.id,
      ip: clientIp(req),
      userAgent: req.headers["user-agent"] ?? null,
    });
    destroySession(user.sessionId);
    clearSessionCookie(res);
    res.json({ ok: true });
  }),
);
authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const db = getDb();
    const departments = db
      .prepare(
        `SELECT d.id, d.code, d.name FROM departments d          ${user.allDepartments ? "" : "JOIN user_departments ud ON ud.department_id = d.id AND ud.user_id = ?"}          WHERE d.is_active = 1 ORDER BY d.name`,
      )
      .all(...(user.allDepartments ? [] : [user.id])) as Array<{
      id: number;
      code: string;
      name: string;
    }>;
    res.json({ user: userPayload(user), departments });
  }),
);
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});
authRouter.post(
  "/change-password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const input = validate(changePasswordSchema, req.body);
    const db = getDb();
    const row = db
      .prepare("SELECT password_hash FROM users WHERE id = ?")
      .get(user.id) as { password_hash: string };
    if (!verifyPassword(input.currentPassword, row.password_hash)) {
      throw new ApiError(422, "Kata sandi saat ini tidak sesuai.");
    }
    const issue = passwordIssue(input.newPassword);
    if (issue) throw new ApiError(422, issue);
    db.prepare(
      "UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?",
    ).run(hashPassword(input.newPassword), nowIso(), user.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND id <> ?").run(
      user.id,
      user.sessionId,
    );
    writeAudit(db, {
      actor: user,
      action: "CHANGE_PASSWORD",
      entityType: "users",
      entityId: user.id,
      ip: clientIp(req),
      userAgent: req.headers["user-agent"] ?? null,
    });
    res.json({ ok: true, message: "Kata sandi berhasil diubah." });
  }),
);
