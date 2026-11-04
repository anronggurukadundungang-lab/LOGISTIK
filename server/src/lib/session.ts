import type { NextFunction, Request, Response } from "express";
import { config } from "../config.ts";
import { getDb, nowIso } from "../db.ts";
import { randomToken, sha256 } from "./password.ts";
import { ApiError, clientIp } from "./http.ts";
import {
  hasAnyPermission,
  hasPermission,
  loadUserBySession,
  type AuthUser,
} from "./auth.ts";

export const SESSION_COOKIE = "stok_session";

export function createSession(
  userId: number,
  req: Request,
): { token: string; csrfToken: string; expiresAt: string } {
  const db = getDb();
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const id = sha256(token);
  const expiresAt = new Date(
    Date.now() + config.sessionTtlHours * 3_600_000,
  ).toISOString();

  db.prepare(
    "INSERT INTO sessions (id, user_id, csrf_token, ip, user_agent, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    userId,
    csrfToken,
    clientIp(req),
    req.headers["user-agent"] ?? null,
    nowIso(),
    expiresAt,
  );

  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(nowIso());
  return { token, csrfToken, expiresAt };
}

export function setSessionCookie(
  res: Response,
  token: string,
  expiresAt: string,
): void {
  const maxAge = Math.max(0, new Date(expiresAt).getTime() - Date.now());
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    path: "/",
    maxAge,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
  });
}

export function destroySession(sessionId: string): void {
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

export function attachUser(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (token) {
    const user = loadUserBySession(sha256(token));
    if (user) req.user = user;
  }
  next();
}

export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    next(
      new ApiError(
        401,
        "Sesi tidak valid atau sudah berakhir. Silakan login kembali.",
      ),
    );
    return;
  }
  next();
}

export function requirePermission(permission: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user)
      return next(new ApiError(401, "Silakan login terlebih dahulu."));
    if (!hasPermission(req.user, permission)) {
      return next(
        new ApiError(403, "Anda tidak memiliki hak akses untuk tindakan ini."),
      );
    }
    next();
  };
}

export function requireAnyPermission(permissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user)
      return next(new ApiError(401, "Silakan login terlebih dahulu."));
    if (!hasAnyPermission(req.user, permissions)) {
      return next(
        new ApiError(403, "Anda tidak memiliki hak akses untuk tindakan ini."),
      );
    }
    next();
  };
}

/** Proteksi CSRF double-submit: header harus sama dengan token pada sesi. */
export function csrfProtection(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (!req.user) return next();
  const header = req.get("x-csrf-token");
  if (!header || header !== req.user.csrfToken) {
    next(
      new ApiError(
        403,
        "Token keamanan (CSRF) tidak valid. Muat ulang halaman lalu coba lagi.",
      ),
    );
    return;
  }
  next();
}

/** Rate limiting login sederhana per IP (proses tunggal). */
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

export function checkLoginRateLimit(req: Request): void {
  const key = clientIp(req);
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (entry && entry.resetAt > now && entry.count >= 20) {
    throw new ApiError(
      429,
      "Terlalu banyak percobaan login. Coba lagi dalam 15 menit.",
    );
  }
  if (!entry || entry.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60_000 });
  } else {
    entry.count += 1;
  }
}

export function resetLoginRateLimit(req: Request): void {
  loginAttempts.delete(clientIp(req));
}

export function userPayload(user: AuthUser) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: { code: user.roleCode, name: user.roleName },
    permissions: user.permissions,
    departmentIds: user.departmentIds,
    allDepartments: user.allDepartments,
    mustChangePassword: user.mustChangePassword,
    csrfToken: user.csrfToken,
  };
}
