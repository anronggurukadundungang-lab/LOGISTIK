import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { config } from "./config.ts";
import "pg"; // efek samping: pastikan pg ikut ter-bundle (worker memuatnya via path).
import { MIGRATIONS } from "./migrations/index.ts";

/**
 * API database sinkron (kompatibel node:sqlite) di atas PostgreSQL/Supabase.
 *
 * Query dieksekusi worker thread (source di WORKER_SOURCE di bawah) yang memegang
 * satu koneksi Postgres. Thread utama mengirim permintaan lalu menunggu dengan
 * Atomics.wait, sehingga `db.prepare(...).get/all/run` tetap bisa dipanggil
 * secara sinkron seperti sebelumnya — service dan route tidak perlu async.
 * Koneksi tunggal + serial menjaga semantik transaksi withTx (BEGIN/COMMIT pada
 * koneksi yang sama dengan semua query di dalamnya).
 *
 * Terjemahan SQL SQLite -> Postgres ada di WORKER_SOURCE:
 * - placeholder `?` -> `$1..$n`
 * - `INSERT OR IGNORE INTO` -> `INSERT INTO ... ON CONFLICT DO NOTHING`
 * - `GROUP_CONCAT(expr)` -> `string_agg((expr)::text, ',')`
 * - `COLLATE NOCASE` -> dihapus (kolom skema memakai citext)
 * - `PRAGMA ...` -> diabaikan
 * - INSERT mengembalikan `lastInsertRowid` via `RETURNING id` (tabel ber-kolom id)
 */

const requirePg = createRequire(import.meta.url);
const PG_PATH = requirePg.resolve("pg");

export interface QueryRow {
  [key: string]: unknown;
}

interface WorkerResponse {
  id: number;
  ok: boolean;
  rows?: QueryRow[];
  rowCount?: number;
  lastInsertRowid?: number;
  error?: string;
}

const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Worker di-inline sebagai source string (eval) agar tidak perlu file terpisah:
 * aman untuk bundler serverless (Vercel) yang tidak melacak `new Worker(url)`.
 * Kode di bawah adalah JavaScript CJS biasa yang berjalan di worker thread.
 */
const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const pg = require(workerData.pgPath);

function translateSql(input) {
  let sql = input;
  sql = sql.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, "INSERT INTO");
  if (/^INSERT\s+INTO/i.test(sql.trim())) {
    sql += " ON CONFLICT DO NOTHING";
  }
  sql = sql.replace(
    /\bGROUP_CONCAT\s*\(([^()]*)\)/gi,
    (_m, expr) => "string_agg((" + expr + ")::text, ',')",
  );
  sql = sql.replace(/\bCOLLATE\s+NOCASE\b/gi, "");
  return sql;
}

function toPlaceholders(sql, params) {
  let out = "";
  let paramIndex = 0;
  let inString = false;
  let quoteChar = "";
  for (const char of sql) {
    if (inString) {
      out += char;
      if (char === quoteChar) inString = false;
      continue;
    }
    if (char === "'" || char === '"') {
      inString = true;
      quoteChar = char;
      out += char;
      continue;
    }
    if (char === "?") {
      paramIndex += 1;
      if (paramIndex > params.length) {
        throw new Error("Placeholder ke-" + paramIndex + " tanpa parameter pada query: " + sql);
      }
      out += "$" + paramIndex;
      continue;
    }
    out += char;
  }
  if (paramIndex !== params.length) {
    throw new Error(
      "Jumlah placeholder (" + paramIndex + ") tidak sama dengan parameter (" + params.length + "): " + sql,
    );
  }
  return { sql: out, values: params };
}

const idColumnCache = new Map();
async function tableHasIdColumn(client, tableName) {
  const cached = idColumnCache.get(tableName);
  if (cached !== undefined) return cached;
  const result = await client.query(
    "SELECT 1 AS ok FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = 'id'",
    [tableName],
  );
  const hasId = result.rows.length > 0;
  idColumnCache.set(tableName, hasId);
  return hasId;
}

async function main() {
  const client = new pg.Client({
    connectionString: workerData.connectionString,
    ssl: /supabase\.(co|com)/i.test(workerData.connectionString)
      ? { rejectUnauthorized: false }
      : workerData.ssl === true
        ? { rejectUnauthorized: false }
        : undefined,
  });
  await client.connect();
  if (workerData.resetSchema) {
    const schema = workerData.schemaName || "test";
    await client.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
    await client.query("CREATE SCHEMA " + schema);
    await client.query("SET search_path TO " + schema);
    idColumnCache.clear();
  }

  async function execute(request) {
    try {
      if (request.multi) {
        const statements = request.sql
          .split(";")
          .map((s) => s.trim())
          .filter((s) => s && !/^PRAGMA\b/i.test(s));
        for (const statement of statements) {
          await client.query(statement);
        }
        return { id: request.id, ok: true, rows: [], rowCount: 0, lastInsertRowid: 0 };
      }
      const translated = translateSql(request.sql);
      const { sql, values } = toPlaceholders(translated, request.params || []);
      const insertMatch = sql.match(/^INSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
      if (insertMatch && !/\bRETURNING\b/i.test(sql)) {
        if (await tableHasIdColumn(client, insertMatch[1])) {
          const result = await client.query(sql + " RETURNING id");
          const lastRow = result.rows[result.rows.length - 1];
          return {
            id: request.id,
            ok: true,
            rows: result.rows,
            rowCount: result.rowCount || 0,
            lastInsertRowid: lastRow && lastRow.id != null ? Number(lastRow.id) : 0,
          };
        }
      }
      const result = await client.query(sql, values);
      return {
        id: request.id,
        ok: true,
        rows: result.rows,
        rowCount: result.rowCount || 0,
        lastInsertRowid: 0,
      };
    } catch (error) {
      return { id: request.id, ok: false, error: error.message };
    }
  }

  parentPort.on("message", (request) => {
    execute(request).then((response) => parentPort.postMessage(response));
  });
}

main().catch((error) => {
  parentPort.postMessage({ id: -1, ok: false, error: "Koneksi database gagal: " + error.message });
  process.exit(1);
});
`;

class SyncBridge {
  private readonly worker: Worker;
  private readonly signal = new Int32Array(new SharedArrayBuffer(4));
  private nextId = 1;
  private pending: WorkerResponse | null = null;
  private initError: string | null = null;

  constructor(workerData: {
    connectionString: string;
    resetSchema: boolean;
    schemaName?: string;
    ssl?: boolean;
  }) {
    this.worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { ...workerData, pgPath: PG_PATH },
    });
    this.worker.on("message", (response: WorkerResponse) => {
      if (response.id === -1) {
        this.initError = response.error ?? "Koneksi database gagal.";
        Atomics.store(this.signal, 0, 1);
        Atomics.notify(this.signal, 0);
        return;
      }
      this.pending = response;
      Atomics.add(this.signal, 0, 1);
      Atomics.notify(this.signal, 0);
    });
    this.worker.on("error", (error) => {
      this.initError = `Worker database error: ${error.message}`;
      Atomics.store(this.signal, 0, 1);
      Atomics.notify(this.signal, 0);
    });
    this.worker.unref();
  }

  private request(sql: string, params: Array<unknown>, multi: boolean): WorkerResponse {
    if (this.initError) throw new Error(this.initError);
    const id = this.nextId;
    this.nextId += 1;
    this.pending = null;
    const seqBefore = Atomics.load(this.signal, 0);
    this.worker.postMessage({ id, sql, params, multi });
    if (Atomics.load(this.signal, 0) === seqBefore) {
      const outcome = Atomics.wait(this.signal, 0, seqBefore, REQUEST_TIMEOUT_MS);
      if (outcome === "timed-out") {
        throw new Error(
          `Query database melebihi ${REQUEST_TIMEOUT_MS / 1000} detik: ${sql.slice(0, 120)}`,
        );
      }
      if (outcome !== "ok") {
        throw new Error(`Worker database terputus (status: ${outcome}).`);
      }
    }
    const response = this.pending as WorkerResponse | null;
    if (!response) throw new Error("Respons database tidak ditemukan.");
    if (!response.ok) throw new Error(response.error ?? "Query database gagal.");
    return response;
  }

  get(sql: string, params: Array<unknown>): QueryRow | undefined {
    return this.request(sql, params, false).rows?.[0];
  }

  all(sql: string, params: Array<unknown>): QueryRow[] {
    return this.request(sql, params, false).rows ?? [];
  }

  run(sql: string, params: Array<unknown>): { lastInsertRowid: number; changes: number } {
    const response = this.request(sql, params, false);
    return {
      lastInsertRowid: response.lastInsertRowid ?? 0,
      changes: response.rowCount ?? 0,
    };
  }

  exec(sql: string): void {
    this.request(sql, [], true);
  }

  terminate(): Promise<void> {
    return this.worker.terminate().then(() => undefined);
  }
}

let bridge: SyncBridge | null = null;

function resolveConnectionString(databasePath: string): {
  connectionString: string;
  resetSchema: boolean;
  ssl?: boolean;
} {
  if (databasePath === ":memory:") {
    // Konvensi lama untuk pengujian: database uji terpisah dengan schema sendiri.
    const url = process.env.TEST_DATABASE_URL;
    if (!url) {
      throw new Error(
        "Pengujian membutuhkan TEST_DATABASE_URL (Postgres terpisah/schema uji). " +
          "Contoh: TEST_DATABASE_URL=postgresql://localhost:54329/postgres",
      );
    }
    return { connectionString: url, resetSchema: true };
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL tidak diatur. Isi connection string PostgreSQL (Supabase) pada .env, " +
        "contoh: DATABASE_URL=postgresql://postgres.xxx:password@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres",
    );
  }
  // Izinkan PG supaya testing lokal (mis. PGlite/pglite-socket) tidak wajib SSL.
  const ssl = process.env.DATABASE_SSL === "require";
  return { connectionString: url, resetSchema: false, ssl };
}

export function openDb(databasePath = config.databasePath): void {
  if (bridge) return;
  const resolved = resolveConnectionString(databasePath);
  bridge = new SyncBridge(resolved);
}

class DatabaseHandle {
  prepare(sql: string) {
    openDb();
    return {
      get: (...params: Array<unknown>) => bridge!.get(sql, params),
      all: (...params: Array<unknown>) => bridge!.all(sql, params),
      run: (...params: Array<unknown>) => bridge!.run(sql, params),
    };
  }

  exec(sql: string): void {
    openDb();
    bridge!.exec(sql);
  }
}

export type DatabaseSync = DatabaseHandle;

const sharedHandle = new DatabaseHandle();

export function getDb(): DatabaseHandle {
  openDb();
  return sharedHandle;
}

export function setDb(instance: DatabaseHandle | null): void {
  // Kompatibilitas API lama; bridge tunggal tidak diganti-ganti.
  void instance;
}

export function closeDb(): void {
  if (bridge) {
    void bridge.terminate();
    bridge = null;
  }
}

/** Jalankan fn di dalam satu transaksi pada koneksi tunggal (pengganti BEGIN IMMEDIATE). */
export function withTx<T>(fn: (database: DatabaseSync) => T): T {
  const database = getDb();
  database.exec("BEGIN");
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
  for (const migration of MIGRATIONS) {
    const exists = database
      .prepare("SELECT 1 AS ok FROM schema_migrations WHERE name = ?")
      .get(migration.name) as { ok: number } | undefined;
    if (exists) continue;
    try {
      database.exec(migration.sql);
      database
        .prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)")
        .run(migration.name, nowIso());
    } catch (error) {
      throw new Error(`Migrasi ${migration.name} gagal: ${(error as Error).message}`);
    }
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
