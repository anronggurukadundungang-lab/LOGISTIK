/**
 * Entrypoint serverless Vercel untuk API Express.
 * Di-bundle dengan esbuild menjadi satu file CJS (api/index.cjs) sehingga tidak
 * bergantung pada tracing file @vercel/node. bootstrap() menjalankan migrasi
 * skema + seed secara sinkron melalui bridge DB.
 */
import { createApp, bootstrap } from "./app.ts";

bootstrap();

const app = createApp();

export default app;
