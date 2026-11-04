/**
 * Migrasi data dari SQLite lokal (data/stok.db) ke PostgreSQL/Supabase.
 *
 * Pemakaian:
 *   DATABASE_URL=postgresql://... npm --workspace server exec tsx -- src/scripts/migrate-sqlite-to-pg.ts [path-sqlite]
 *
 * - Skema tidak dibuat di sini; jalankan aplikasi sekali (bootstrap) agar migrasi
 *   skema Postgres jalan dulu, lalu jalankan script ini.
 * - Data tabel yang sudah berisi di Postgres TIDAK ditimpa (idempotent per tabel
 *   yang masih kosong). Urutan insert mengikuti dependensi FK.
 * - Kolom json disalin apa adanya (TEXT). ID asli dipertahankan agar FK konsisten.
 */
import path from "node:path";
import { DatabaseSync as SqliteDatabase } from "node:sqlite";
import pg from "pg";
import { config } from "../config.ts";

/** Urutan tabel mengikuti dependensi foreign key. */
const TABLES = [
  "roles",
  "permissions",
  "role_permissions",
  "users",
  "sessions",
  "departments",
  "user_departments",
  "item_categories",
  "units",
  "items",
  "item_unit_conversions",
  "stock_entries",
  "department_stock_balances",
  "stock_consumptions",
  "stock_returns",
  "stock_damages",
  "stock_adjustments",
  "simdondar_import_batches",
  "simdondar_import_rows",
  "simdondar_transactions",
  "stock_opname_sessions",
  "stock_opname_details",
  "approval_requests",
  "audit_logs",
  "notifications",
  "settings",
  "document_sequences",
  "attachments",
  "import_mapping_profiles",
] as const;

const CITEXT_TABLES = new Map<string, string[]>([
  ["users", ["username"]],
  ["departments", ["name"]],
  ["item_categories", ["name"]],
  ["units", ["code", "name"]],
  ["items", ["code"]],
]);

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL tidak diatur. Isi connection string Supabase pada environment.");
  }
  const sqlitePath = process.argv[2] ?? path.resolve(config.serverRoot, "..", "data", "stok.db");
  const sqlite = new SqliteDatabase(sqlitePath);
  const pgClient = new pg.Client({
    connectionString: databaseUrl,
    ssl: /supabase\.(co|com)/i.test(databaseUrl) ? { rejectUnauthorized: false } : undefined,
  });
  await pgClient.connect();

  try {
    await pgClient.query("SET session_replication_role = replica"); // nonaktifkan pemicu FK saat salin
    for (const table of TABLES) {
      const rows = sqlite.prepare(`SELECT * FROM ${table}`).all() as Array<
        Record<string, unknown>
      >;
      if (!rows.length) {
        console.log(`${table}: kosong, dilewati.`);
        continue;
      }
      const existing = await pgClient.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
      if (existing.rows[0].n > 0) {
        console.log(`${table}: sudah berisi ${existing.rows[0].n} baris, dilewati.`);
        continue;
      }
      const columns = Object.keys(rows[0]);
      const citext = CITEXT_TABLES.get(table) ?? [];
      const valuesSql: string[] = [];
      const flat: unknown[] = [];
      let paramIndex = 0;
      for (const row of rows) {
        const placeholders = columns.map((column) => {
          paramIndex += 1;
          const value = row[column];
          flat.push(value === undefined ? null : value);
          return citext.includes(column) ? `$${paramIndex}::citext` : `$${paramIndex}`;
        });
        valuesSql.push(`(${placeholders.join(", ")})`);
      }
      await pgClient.query(
        `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${valuesSql.join(", ")}`,
        flat,
      );
      console.log(`${table}: ${rows.length} baris disalin.`);
    }
  } finally {
    // Reset sequence identity agar insert berikutnya tidak bentrok dengan ID hasil copy.
    const idTables = await pgClient.query(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND column_name = 'id'
          AND column_default LIKE 'nextval%'`,
    );
    for (const { table_name } of idTables.rows) {
      const max = await pgClient.query(
        `SELECT COALESCE(MAX(id), 0)::bigint AS m FROM ${table_name}`,
      );
      await pgClient.query(
        `SELECT setval(pg_get_serial_sequence('${table_name}', 'id'), $1, true)`,
        [max.rows[0].m],
      );
    }
    console.log("Sequence identity direset ke MAX(id).");
    await pgClient.query("SET session_replication_role = DEFAULT");
    await pgClient.end();
    sqlite.close();
  }
  console.log("Migrasi data selesai.");
}

main().catch((error) => {
  console.error("Migrasi data gagal:", (error as Error).message);
  process.exit(1);
});
