import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.ts";

let db: DatabaseSync | null = null;

export function openDb(databasePath = config.databasePath): DatabaseSync {
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const instance = new DatabaseSync(databasePath);
  instance.exec("PRAGMA foreign_keys = ON;");
  instance.exec("PRAGMA busy_timeout = 5000;");
  if (databasePath !== ":memory:") {
    instance.exec("PRAGMA journal_mode = WAL;");
    instance.exec("PRAGMA synchronous = NORMAL;");
  }
  return instance;
}

export function getDb(): DatabaseSync {
  if (!db) {
    db = openDb();
    runMigrations(db);
  }
  return db;
}

export function setDb(instance: DatabaseSync | null): void {
  db = instance;
}

export function closeDb(): void {
  if (db) {
    try {
      db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    } catch {
      /* ignore */
    }
    db.close();
    db = null;
  }
}

/** Jalankan fn di dalam satu transaksi tulis. SQLite menserialkan penulisan. */
export function withTx<T>(fn: (database: DatabaseSync) => T): T {
  const database = getDb();
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = fn(database);
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      /* transaksi mungkin sudah dibatalkan */
    }
    throw error;
  }
}

export function runMigrations(database: DatabaseSync = getDb()): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const migrationsDir = path.resolve(config.serverRoot, "src", "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const exists = database
      .prepare("SELECT 1 AS ok FROM schema_migrations WHERE name = ?")
      .get(file);
    if (exists) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(sql);
      database
        .prepare(
          "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
        )
        .run(file, nowIso());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw new Error(`Migrasi ${file} gagal: ${(error as Error).message}`);
    }
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
