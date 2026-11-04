import fs from "node:fs";
import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import multer from "multer";
import { config } from "./config.ts";
import { getDb, runMigrations } from "./db.ts";
import { seedBase } from "./seed.ts";
import { ApiError, errorHandler } from "./lib/http.ts";
import { attachUser, csrfProtection } from "./lib/session.ts";
import { authRouter } from "./routes/auth.ts";
import { masterRouter } from "./routes/master.ts";
import { usersRouter } from "./routes/users.ts";
import { importsRouter } from "./routes/imports.ts";
import { receiptsRouter } from "./routes/receipts.ts";
import { stockRouter } from "./routes/stock.ts";
import { approvalsRouter } from "./routes/approvals.ts";
import { opnamesRouter } from "./routes/opnames.ts";
import { dashboardRouter } from "./routes/dashboard.ts";
import { reportsRouter } from "./routes/reports.ts";
import { adminRouter } from "./routes/admin.ts";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
  app.use(cookieParser());
  app.use(attachUser);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  app.get("/api/public/settings", (_req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        "SELECT key, value FROM settings WHERE key IN ('app_name','organization_name')",
      )
      .all() as Array<{ key: string; value: string }>;
    res.json({
      settings: Object.fromEntries(rows.map((row) => [row.key, row.value])),
    });
  });

  app.use("/api/auth", authRouter);

  // Semua request mutasi setelah login wajib membawa token CSRF.
  app.use("/api", csrfProtection);

  app.use("/api", masterRouter);
  app.use("/api", usersRouter);
  app.use("/api", importsRouter);
  app.use("/api", receiptsRouter);
  app.use("/api", stockRouter);
  app.use("/api", approvalsRouter);
  app.use("/api", opnamesRouter);
  app.use("/api", dashboardRouter);
  app.use("/api", reportsRouter);
  app.use("/api", adminRouter);

  app.use("/api", (_req, _res, next) => {
    next(new ApiError(404, "Endpoint tidak ditemukan."));
  });

  if (fs.existsSync(config.clientDist)) {
    app.use(express.static(config.clientDist, { index: false, maxAge: "1h" }));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) return next();
      res.sendFile(path.join(config.clientDist, "index.html"));
    });
  }

  app.use(
    (
      error: unknown,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          res
            .status(413)
            .json({
              error: `Ukuran file melebihi batas ${(config.maxUploadBytes / 1024 / 1024).toFixed(0)} MB.`,
            });
          return;
        }
        res.status(422).json({ error: `Upload gagal: ${error.message}` });
        return;
      }
      errorHandler(error, req, res, next);
    },
  );

  return app;
}

export function bootstrap() {
  getDb();
  runMigrations();
  seedBase();
}
