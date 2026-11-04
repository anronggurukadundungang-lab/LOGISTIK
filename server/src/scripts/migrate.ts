import { runMigrations } from "../db.ts";
import { config } from "../config.ts";

runMigrations();
// eslint-disable-next-line no-console
console.log(`Migrasi selesai. Database: ${config.databasePath}`);
