import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { getDb, nowIso } from "../db.ts";
import { config } from "../config.ts";
import {
  ApiError,
  asyncHandler,
  clientIp,
  paginated,
  parsePage,
  validate,
} from "../lib/http.ts";
import { requirePermission } from "../lib/session.ts";
import { writeAudit } from "../lib/auth.ts";
import {
  buildImportTemplate,
  commitBatch,
  getBatchPreview,
  getImportErrorsWorkbook,
  parseFileBuffer,
  suggestMapping,
  validateBatch,
  type Mapping,
} from "../services/import.ts";
export const importsRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, callback) => {
    const ext = file.originalname.toLowerCase().split(".").pop();
    if (ext === "xlsx" || ext === "csv" || ext === "pdf") {
      callback(null, true);
    } else {
      callback(
        new ApiError(
          422,
          "Format file harus .xlsx, .csv, atau .pdf. Untuk file .xls, simpan ulang sebagai .xlsx.",
        ),
      );
    }
  },
});
importsRouter.post(
  "/imports/upload",
  requirePermission("imports.manage"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const file = req.file;
    if (!file) throw new ApiError(422, "Pilih file yang akan diunggah.");
    const ext = file.originalname.toLowerCase().split(".").pop();
    if (!["xlsx", "csv", "pdf"].includes(ext ?? "")) {
      throw new ApiError(422, "Format file harus .xlsx, .csv, atau .pdf.");
    }
    let parsed;
    try {
      parsed = await parseFileBuffer(file.buffer, file.originalname);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        422,
        `File tidak dapat dibaca: ${(error as Error).message}`,
      );
    }
    const db = getDb();
    const savedMapping = db
      .prepare("SELECT value FROM settings WHERE key = 'import_mapping'")
      .get() as { value: string } | undefined;
    let mapping: Mapping = suggestMapping(parsed.headers);
    if (savedMapping?.value) {
      try {
        const previous = JSON.parse(savedMapping.value) as Mapping;
        const validPrevious = Object.fromEntries(
          Object.entries(previous).filter(([, header]) =>
            parsed.headers.includes(header),
          ),
        );
        if (Object.keys(validPrevious).length)
          mapping = { ...mapping, ...validPrevious };
      } catch {
        /* abaikan mapping lama yang rusak */
      }
    }
    const now = nowIso();
    const inserted = db
      .prepare(
        `INSERT INTO simdondar_import_batches          (filename, file_type, file_size, original_headers_json, mapping_json, status, total_rows,           receipt_mode, created_by, created_at)         VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)`,
      )
      .run(
        file.originalname,
        ext ?? "xlsx",
        file.size,
        JSON.stringify(parsed.headers),
        JSON.stringify(mapping),
        parsed.rows.length,
        (
          db
            .prepare("SELECT value FROM settings WHERE key = 'receipt_mode'")
            .get() as { value?: string } | undefined
        )?.value ?? "confirm",
        user.id,
        now,
      );
    const batchId = Number(inserted.lastInsertRowid);
    const insertRow = db.prepare(
      "INSERT INTO simdondar_import_rows (batch_id, row_number, raw_json, status, created_at) VALUES (?, ?, ?, 'PENDING', ?)",
    );
    db.exec("BEGIN IMMEDIATE");
    try {
      parsed.rows.forEach((row, index) => {
        insertRow.run(batchId, index + 1, JSON.stringify(row), now);
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    writeAudit(db, {
      actor: user,
      action: "UPLOAD_IMPORT",
      entityType: "simdondar_import_batches",
      entityId: batchId,
      after: {
        filename: file.originalname,
        rows: parsed.rows.length,
        headers: parsed.headers,
      },
      ip: clientIp(req),
      userAgent: req.headers["user-agent"] ?? null,
    });
    res
      .status(201)
      .json({
        batchId,
        filename: file.originalname,
        headers: parsed.headers,
        totalRows: parsed.rows.length,
        mapping,
        sampleRows: parsed.rows.slice(0, 5),
      });
  }),
);
importsRouter.get(
  "/imports",
  requirePermission("imports.view"),
  asyncHandler(async (req, res) => {
    const page = parsePage(req.query as Record<string, unknown>, 20);
    const db = getDb();
    const total = Number(
      (
        db
          .prepare("SELECT COUNT(*) AS total FROM simdondar_import_batches")
          .get() as { total: number }
      ).total,
    );
    const items = db
      .prepare(
        `SELECT b.*, u.name AS created_by_name,                (SELECT COUNT(*) FROM simdondar_transactions t WHERE t.import_batch_id = b.id) AS transaction_count           FROM simdondar_import_batches b JOIN users u ON u.id = b.created_by          ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(page.pageSize, page.offset);
    res.json(paginated(items, total, page));
  }),
);
importsRouter.get(
  "/imports/template.xlsx",
  requirePermission("imports.view"),
  asyncHandler(async (_req, res) => {
    const buffer = await buildImportTemplate();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="template-import-simdondar.xlsx"',
    );
    res.send(buffer);
  }),
);
importsRouter.get(
  "/imports/:id",
  requirePermission("imports.view"),
  asyncHandler(async (req, res) => {
    const preview = getBatchPreview(Number(req.params.id), 500);
    res.json(preview);
  }),
);
const mappingSchema = z.object({
  mapping: z.record(z.string(), z.string()),
  autoCreate: z.boolean().optional().default(false),
});
importsRouter.post(
  "/imports/:id/validate",
  requirePermission("imports.manage"),
  asyncHandler(async (req, res) => {
    const input = validate(mappingSchema, req.body);
    const result = validateBatch(
      req.user!,
      Number(req.params.id),
      input.mapping,
      { ip: clientIp(req), userAgent: req.headers["user-agent"] ?? "" },
      { autoCreate: input.autoCreate },
    );
    res.json({
      ...result,
      preview: getBatchPreview(Number(req.params.id), 100),
    });
  }),
);
const commitSchema = z.object({
  includeSuspects: z.boolean().optional().default(false),
  notes: z.string().trim().max(500).optional().nullable(),
});
importsRouter.post(
  "/imports/:id/commit",
  requirePermission("imports.manage"),
  asyncHandler(async (req, res) => {
    const input = validate(commitSchema, req.body ?? {});
    const result = commitBatch(req.user!, Number(req.params.id), input, {
      ip: clientIp(req),
      userAgent: req.headers["user-agent"] ?? "",
    });
    res.json(result);
  }),
);
importsRouter.get(
  "/imports/:id/errors.xlsx",
  requirePermission("imports.view"),
  asyncHandler(async (req, res) => {
    const batchId = Number(req.params.id);
    const db = getDb();
    const batch = db
      .prepare("SELECT filename FROM simdondar_import_batches WHERE id = ?")
      .get(batchId) as { filename: string } | undefined;
    if (!batch) throw new ApiError(404, "Batch impor tidak ditemukan.");
    const buffer = await getImportErrorsWorkbook(batchId);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="hasil-impor-${batchId}-${batch.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}.xlsx"`,
    );
    res.send(buffer);
  }),
);
