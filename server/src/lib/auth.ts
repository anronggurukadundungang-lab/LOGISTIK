import type { DatabaseSync } from "node:sqlite";
import { getDb } from "../db.ts";
import { ApiError } from "./http.ts";

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  roleId: number;
  roleCode: string;
  roleName: string;
  permissions: string[];
  departmentIds: number[];
  allDepartments: boolean;
  mustChangePassword: boolean;
  csrfToken: string;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function hasPermission(user: AuthUser, permission: string): boolean {
  return user.permissions.includes(permission);
}

export function hasAnyPermission(
  user: AuthUser,
  permissions: string[],
): boolean {
  return permissions.some((permission) =>
    user.permissions.includes(permission),
  );
}

export function canAccessDepartment(
  user: AuthUser,
  departmentId: number,
): boolean {
  if (user.allDepartments) return true;
  return user.departmentIds.includes(departmentId);
}

export function assertDepartmentAccess(
  user: AuthUser,
  departmentId: number,
): void {
  if (!canAccessDepartment(user, departmentId)) {
    throw new ApiError(403, "Anda tidak memiliki akses ke data bagian ini.");
  }
}

export function loadUserBySession(sessionId: string): AuthUser | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.id AS session_id, s.csrf_token, s.expires_at,
              u.id, u.username, u.name, u.must_change_password, u.is_active,
              r.id AS role_id, r.code AS role_code, r.name AS role_name
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         JOIN roles r ON r.id = u.role_id
        WHERE s.id = ?`,
    )
    .get(sessionId) as
    | {
        session_id: string;
        csrf_token: string;
        expires_at: string;
        id: number;
        username: string;
        name: string;
        must_change_password: number;
        is_active: number;
        role_id: number;
        role_code: string;
        role_name: string;
      }
    | undefined;

  if (!row) return null;
  if (!row.is_active) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
    return null;
  }

  const permissions = (
    db
      .prepare(
        `SELECT p.code FROM role_permissions rp
           JOIN permissions p ON p.id = rp.permission_id
          WHERE rp.role_id = ?`,
      )
      .all(row.role_id) as Array<{ code: string }>
  ).map((item) => item.code);

  const departmentIds = (
    db
      .prepare("SELECT department_id FROM user_departments WHERE user_id = ?")
      .all(row.id) as Array<{
      department_id: number;
    }>
  ).map((item) => item.department_id);

  return {
    id: row.id,
    username: row.username,
    name: row.name,
    roleId: row.role_id,
    roleCode: row.role_code,
    roleName: row.role_name,
    permissions,
    departmentIds,
    allDepartments: permissions.includes("stocks.view_all"),
    mustChangePassword: Boolean(row.must_change_password),
    csrfToken: row.csrf_token,
    sessionId: row.session_id,
  };
}

export function writeAudit(
  db: DatabaseSync,
  input: {
    actor?: AuthUser | null;
    action: string;
    entityType: string;
    entityId?: string | number | null;
    before?: unknown;
    after?: unknown;
    reason?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO audit_logs
      (actor_id, actor_name, action, entity_type, entity_id, before_json, after_json, reason, ip, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.actor?.id ?? null,
    input.actor?.name ?? "Sistem",
    input.action,
    input.entityType,
    input.entityId !== null && input.entityId !== undefined
      ? String(input.entityId)
      : null,
    input.before !== undefined ? JSON.stringify(input.before) : null,
    input.after !== undefined ? JSON.stringify(input.after) : null,
    input.reason ?? null,
    input.ip ?? null,
    input.userAgent ?? null,
    new Date().toISOString(),
  );
}

export function notify(
  db: DatabaseSync,
  userIds: number[],
  title: string,
  message: string,
  link?: string,
): void {
  const unique = [...new Set(userIds)];
  const now = new Date().toISOString();
  for (const userId of unique) {
    db.prepare(
      "INSERT INTO notifications (user_id, title, message, link, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(userId, title, message, link ?? null, now);
  }
}
