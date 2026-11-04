import { createApp, bootstrap } from "./app.ts";
import { config } from "./config.ts";
import { closeDb } from "./db.ts";

if (
  config.isProduction &&
  (config.sessionSecret === "dev-only-insecure-session-secret-change-me" ||
    config.sessionSecret.length < 32)
) {
  // eslint-disable-next-line no-console
  console.error(
    "\n  [FATAL] SESSION_SECRET produksi belum diatur atau terlalu pendek (minimal 32 karakter).\n" +
      "  Buat nilai acak, misalnya: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"\n",
  );
  process.exit(1);
}

bootstrap();
const app = createApp();
const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`\n  Sistem Monitoring Stok dan Pemakaian Per Bagian`);
  // eslint-disable-next-line no-console
  console.log(`  Server berjalan di http://localhost:${config.port}`);
  // eslint-disable-next-line no-console
  console.log(`  Database: ${config.databasePath}`);
  // eslint-disable-next-line no-console
  console.log(
    `  Lingkungan: ${config.isProduction ? "production" : "development"}\n`,
  );
});

function shutdown(signal: string) {
  // eslint-disable-next-line no-console
  console.log(`\n[${signal}] Menutup server...`);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
