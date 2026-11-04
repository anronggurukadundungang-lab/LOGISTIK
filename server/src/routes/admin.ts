import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.ts";
import { getDb, nowIso } from "../db.ts";
import {
  ApiError,
  asyncHandler,
  clientIp,
  paginated,
  parsePage,
  validate,
} from "../lib/http.ts";
import { parseDateToIso } from "../lib/utils.ts";
import { requirePermission } from "../lib/session.ts";
import { writeAudit } from "../lib/auth.ts";
export const adminRouter = Router();
adminRouter.get(
  "/audit",
  requirePermission("audit.view"),
  asyncHandler(async (req, res) => {
    const page = parsePage(req.query as Record<string, unknown>, 30);
    const search = String(req.query.search ?? "").trim();
    const action = String(req.query.action ?? "");
    const entityType = String(req.query.entityType ?? "");
    const actorId = req.query.actorId ? Number(req.query.actorId) : null;
    const from = req.query.from ? parseDateToIso(req.query.from) : null;
    const to = req.query.to ? parseDateToIso(req.query.to) : null;
    const where = ["1 = 1"];
    const params: Array<string | number> = [];
    if (search) {
      where.push(
        "(a.actor_name LIKE ? OR a.action LIKE ? OR a.entity_type LIKE ? OR a.reason LIKE ?)",
      );
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (action) {
      where.push("a.action = ?");
      params.push(action);
    }
    if (entityType) {
      where.push("a.entity_type = ?");
      params.push(entityType);
    }
    if (actorId) {
      where.push("a.actor_id = ?");
      params.push(actorId);
    }
    if (from) {
      where.push("a.created_at >= ?");
      params.push(`${from}T00:00:00.000Z`);
    }
    if (to) {
      where.push("a.created_at <= ?");
      params.push(`${to}T23:59:59.999Z`);
    }
    const whereSql = where.join(" AND ");
    const db = getDb();
    const total = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS total FROM audit_logs a WHERE ${whereSql}`,
          )
          .get(...params) as { total: number }
      ).total,
    );
    const items = db
      .prepare(
        `SELECT a.*, u.username FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id          WHERE ${whereSql} ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, page.pageSize, page.offset);
    const actions = db
      .prepare("SELECT DISTINCT action FROM audit_logs ORDER BY action")
      .all() as Array<{ action: string }>;
    const entities = db
      .prepare(
        "SELECT DISTINCT entity_type FROM audit_logs ORDER BY entity_type",
      )
      .all() as Array<{ entity_type: string }>;
    res.json({
      ...paginated(items, total, page),
      meta: {
        actions: actions.map((item) => item.action),
        entities: entities.map((item) => item.entity_type),
      },
    });
  }),
);
adminRouter.get(
  "/settings",
  requirePermission("settings.manage"),
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const settings = db.prepare("SELECT * FROM settings ORDER BY key").all();
    res.json({ items: settings });
  }),
);
const settingsSchema = z.object({
  app_name: z.string().trim().min(3).max(120).optional(),
  organization_name: z.string().trim().min(2).max(120).optional(),
  receipt_mode: z.enum(["auto", "confirm"]).optional(),
  adjustment_approval_threshold: z.coerce.number().min(0).optional(),
  late_input_days: z.coerce.number().int().min(1).max(90).optional(),
  opname_period: z
    .enum(["bulanan", "triwulan", "semester", "tahunan"])
    .optional(),
});
adminRouter.put(
  "/settings",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const input = validate(settingsSchema, req.body);
    const db = getDb();
    const before = db.prepare("SELECT * FROM settings").all() as Array<{
      key: string;
      value: string;
    }>;
    db.exec("BEGIN IMMEDIATE");
    try {
      const now = nowIso();
      for (const [key, value] of Object.entries(input)) {
        if (value === undefined) continue;
        db.prepare(
          `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        ).run(key, String(value), now, user.id);
      }
      writeAudit(db, {
        actor: user,
        action: "UPDATE_SETTINGS",
        entityType: "settings",
        before: Object.fromEntries(before.map((row) => [row.key, row.value])),
        after: input,
        ip: clientIp(req),
        userAgent: req.headers["user-agent"] ?? null,
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    const settings = db.prepare("SELECT * FROM settings ORDER BY key").all();
    res.json({ items: settings });
  }),
);
adminRouter.get(
  "/notifications",
  requirePermission("notifications.view"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const db = getDb();
    const items = db
      .prepare(
        "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30",
      )
      .all(user.id);
    const unread = Number(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0",
          )
          .get(user.id) as { count: number }
      ).count,
    );
    res.json({ items, unread });
  }),
);
adminRouter.post(
  "/notifications/:id/read",
  requirePermission("notifications.view"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const db = getDb();
    db.prepare(
      "UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?",
    ).run(Number(req.params.id), user.id);
    res.json({ ok: true });
  }),
);
adminRouter.post(
  "/notifications/read-all",
  requirePermission("notifications.view"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    getDb()
      .prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ?")
      .run(user.id);
    res.json({ ok: true });
  }),
);
/* ------------------------------- BACKUP ------------------------------- */ adminRouter.post(
  "/system/backup",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    fs.mkdirSync(config.backupsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `stok-backup-${stamp}.db`;
    const target = path.join(config.backupsDir, filename);
    const db = getDb();
    db.exec("PRAGMA wal_checkpoint(FULL);");
    db.prepare("VACUUM INTO ?").run(target);
    const size = fs.statSync(target).size;
    writeAudit(db, {
      actor: user,
      action: "CREATE_BACKUP",
      entityType: "system",
      entityId: filename,
      after: { filename, size },
      ip: clientIp(req),
      userAgent: req.headers["user-agent"] ?? null,
    });
    res
      .status(201)
      .json({ filename, size, message: "Backup database berhasil dibuat." });
  }),
);
adminRouter.get(
  "/system/backups",
  requirePermission("settings.manage"),
  asyncHandler(async (_req, res) => {
    fs.mkdirSync(config.backupsDir, { recursive: true });
    const items = fs
      .readdirSync(config.backupsDir)
      .filter((file) => file.endsWith(".db"))
      .map((file) => {
        const stat = fs.statSync(path.join(config.backupsDir, file));
        return {
          filename: file,
          size: stat.size,
          createdAt: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ items, directory: "data/backups" });
  }),
);
adminRouter.get(
  "/system/backups/:filename",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const filename = path.basename(String(req.params.filename));
    if (!/^[a-zA-Z0-9._-]+\.db$/.test(filename))
      throw new ApiError(422, "Nama file tidak valid.");
    const target = path.join(config.backupsDir, filename);
    if (!fs.existsSync(target))
      throw new ApiError(404, "File backup tidak ditemukan.");
    res.download(target, filename);
  }),
);
