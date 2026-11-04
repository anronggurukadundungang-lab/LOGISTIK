import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import path from "node:path";
import { config } from "./config.ts";
import "pg"; // efek samping: pastikan pg ikut ter-bundle (worker memuatnya via path).
import { MIGRATIONS } from "./migrations/index.ts";

/**
 * API database sinkron (kompatibel node:sqlite) di atas PostgreSQL/Supabase.
 *
 * Query dieksekusi worker thread (source di WORKER_SOURCE) yang memegang satu
 * koneksi Postgres. Thread utama menunggu dengan Atomics.wait; worker menulis
 * respons (JSON) langsung ke SharedArrayBuffer lalu menambah penghitung sinyal,
 * sehingga hasilnya terbaca sinkron tanpa bergantung pada event loop. Dengan itu
 * `db.prepare(...).get/all/run` tetap sinkron seperti node:sqlite — service dan
 * route tidak perlu async. Koneksi tunggal + serial menjaga semantik transaksi
 * withTx (BEGIN/COMMIT pada koneksi yang sama).
 *
 * Terjemahan SQL SQLite -> Postgres ada di WORKER_SOURCE:
 * - placeholder `?` -> `$1..$n`
 * - `INSERT OR IGNORE INTO` -> `INSERT INTO ... ON CONFLICT DO NOTHING`
 * - `GROUP_CONCAT(expr)` -> `string_agg((expr)::text, ',')`
 * - `COLLATE NOCASE` -> dihapus (kolom skema memakai citext)
 * - `PRAGMA ...` -> diabaikan
 * - INSERT mengembalikan `lastInsertRowid` via `RETURNING id` (tabel ber-kolom id)
 */

const requirePg = createRequire(
  path.resolve(process.cwd(), "package.json"),
);
const PG_PATH = requirePg.resolve("pg");

export interface QueryRow {
  [key: string]: unknown;
}

const REQUEST_TIMEOUT_MS = 120_000;

/** Layout SAB: [0]=seq sinyal, [1]=panjang payload (byte), payload mulai byte ke-8. */
const HEADER_BYTES = 8;
const PAYLOAD_BYTES = 32 * 1024 * 1024; // 32 MB cukup untuk satu hasil query terbesar.

const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const pg = require("pg");

const shared = new Uint8Array(workerData.sharedBuffer);
const signal = new Int32Array(workerData.sharedBuffer);
const encoder = new TextEncoder();

function respond(obj) {
  let payload;
  try {
    payload = encoder.encode(JSON.stringify(obj));
  } catch (error) {
    payload = encoder.encode(JSON.stringify({ id: obj.id, ok: false, error: "Serialisasi respons gagal: " + error.message }));
  }
  if (payload.length > shared.byteLength - 8) {
    payload = encoder.encode(JSON.stringify({ id: obj.id, ok: false, error: "Hasil query melebihi buffer " + Math.floor(shared.byteLength / 1048576) + " MB. Batasi jumlah baris query." }));
  }
  Atomics.store(signal, 1, payload.length);
  shared.set(payload, 8);
  Atomics.add(signal, 0, 1);
  Atomics.notify(signal, 0);
}

function translateSql(input) {
  let sql = input;
  sql = sql.replace(/^\s*BEGIN\s+IMMEDIATE\s*$/i, "BEGIN"); // SQLite -> Postgres
  sql = sql.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, "INSERT INTO");
  if (
    /^INSERT\s+INTO/i.test(sql.trim()) &&
    !/\bON\s+CONFLICT\b/i.test(sql) &&
    !/\bRETURNING\b/i.test(sql)
  ) {
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
    await client.query("SET search_path TO " + schema + ", public");
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
          await client.query(translateSql(statement));
        }
        return { id: request.id, ok: true, rows: [], rowCount: 0, lastInsertRowid: 0 };
      }
      const translated = translateSql(request.sql);
      const { sql, values } = toPlaceholders(translated, request.params || []);
      const insertMatch = sql.match(/^INSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
      if (insertMatch && !/\bRETURNING\b/i.test(sql)) {
        if (await tableHasIdColumn(client, insertMatch[1])) {
          const result = await client.query(sql + " RETURNING id", values);
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
    if (process.env.DB_DEBUG === "1") {
      console.log("[worker REQ]", request.id, JSON.stringify(request.sql).slice(0, 60), "params:", JSON.stringify(request.params));
    }
    execute(request).then(respond);
  });
}

main().catch((error) => {
  respond({ id: -1, ok: false, error: "Koneksi database gagal: " + error.message });
  process.exit(1);
});
`;

const decoder = new TextDecoder();

class SyncBridge {
  private readonly worker: Worker;
  private readonly sharedBuffer: SharedArrayBuffer;
  private readonly signal: Int32Array;
  private readonly payload: Uint8Array;
  private nextId = 1;
  private initError: string | null = null;

  constructor(workerData: {
    connectionString: string;
    resetSchema: boolean;
    schemaName?: string;
    ssl?: boolean;
  }) {
    this.sharedBuffer = new SharedArrayBuffer(HEADER_BYTES + PAYLOAD_BYTES);
    this.signal = new Int32Array(this.sharedBuffer);
    this.payload = new Uint8Array(this.sharedBuffer, HEADER_BYTES);
    this.worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        ...workerData,
        pgPath: PG_PATH,
        sharedBuffer: this.sharedBuffer,
      },
    });
    this.worker.unref();
  }

  private readResponse(): WorkerResponse {
    const length = Atomics.load(this.signal, 1);
    const bytes = this.payload.slice(0, length);
    return JSON.parse(decoder.decode(bytes)) as WorkerResponse;
  }

  private request(sql: string, params: Array<unknown>, multi: boolean): WorkerResponse {
    if (this.initError) throw new Error(this.initError);
    const seqBefore = Atomics.load(this.signal, 0);
    this.worker.postMessage({ id: this.nextId, sql, params, multi });
    this.nextId += 1;
    const deadline = Date.now() + REQUEST_TIMEOUT_MS;
    while (Atomics.load(this.signal, 0) === seqBefore) {
      const outcome = Atomics.wait(this.signal, 0, seqBefore, REQUEST_TIMEOUT_MS);
      if (outcome === "timed-out" || Date.now() > deadline) {
        throw new Error(
          `Query database melebihi ${REQUEST_TIMEOUT_MS / 1000} detik: ${sql.slice(0, 120)}`,
        );
      }
      if (outcome !== "ok") {
        throw new Error(`Worker database terputus (status: ${outcome}).`);
      }
    }
    const response = this.readResponse();
    if (response.id === -1) {
      this.initError = response.error ?? "Koneksi database gagal.";
      throw new Error(this.initError);
    }
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

interface WorkerResponse {
  id: number;
  ok: boolean;
  rows?: QueryRow[];
  rowCount?: number;
  lastInsertRowid?: number;
  error?: string;
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
        "contoh: DATABASE_URL=postgresql://postgres.xxx:password@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres",
    );
  }
  // DATABASE_SSL=require untuk Postgres non-Supabase yang mewajibkan SSL.
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
