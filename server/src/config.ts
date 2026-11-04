import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// serverRoot: folder server/ pada dev (ESM/tsx); pada bundle CJS (Vercel),
// __dirname = folder output (api/) sehingga serverRoot = proyek.
const serverRoot =
  typeof __dirname === "string"
    ? path.resolve(__dirname, "..")
    : path.resolve(fileURLToPath(new URL("..", import.meta.url)));
dotenv.config({ path: path.join(serverRoot, "..", ".env") });
dotenv.config({ path: path.join(serverRoot, ".env") });

function envBool(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

// DATABASE_PATH hanya penanda: ":memory:" = database uji (TEST_DATABASE_URL);
// nilai lain = produksi/dev, koneksi memakai DATABASE_URL (PostgreSQL/Supabase).
const databasePath = process.env.DATABASE_PATH ?? "postgres";

export const config = {
  serverRoot,
  projectRoot: path.resolve(serverRoot, ".."),
  port: Number(process.env.PORT ?? 3000),
  isProduction: process.env.NODE_ENV === "production",
  databasePath,
  uploadsDir: path.resolve(serverRoot, "..", "uploads"),
  backupsDir: path.resolve(serverRoot, "..", "data", "backups"),
  clientDist: path.resolve(serverRoot, "..", "client", "dist"),
  sessionSecret:
    process.env.SESSION_SECRET ?? "dev-only-insecure-session-secret-change-me",
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 8),
  cookieSecure: envBool(process.env.COOKIE_SECURE, false),
  appUrl: process.env.APP_URL ?? "http://localhost:5173",
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024),
  seedAdminUsername: process.env.SEED_ADMIN_USERNAME ?? "admin",
  seedAdminName: process.env.SEED_ADMIN_NAME ?? "Administrator Sistem",
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD ?? "Admin#12345",
  timezone: process.env.APP_TIMEZONE ?? "Asia/Jakarta",
};

export const isTest = process.env.NODE_ENV === "test";
