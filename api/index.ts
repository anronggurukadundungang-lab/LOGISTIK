/**
 * Entrypoint serverless Vercel untuk API Express.
 * bootstrap() menjalankan migrasi + seed secara sinkron melalui bridge DB.
 * Migrasi skema tertanam sebagai modul TS (server/src/migrations/index.ts),
 * jadi tidak ada file .sql yang perlu disertakan dalam bundle.
 */
import { createApp, bootstrap } from "../server/src/app.ts";

bootstrap();

const app = createApp();

export default app;
