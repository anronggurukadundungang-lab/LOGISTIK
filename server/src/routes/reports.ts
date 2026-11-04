import { Router, type Request } from "express";
import { z } from "zod";
import { asyncHandler, validate } from "../lib/http.ts";
import {
  buildReport,
  REPORT_TYPES,
  type ReportFilters,
} from "../services/reports.ts";
import { reportToExcel, reportToPdf } from "../services/export.ts";
import { requirePermission } from "../lib/session.ts";
import { assertDepartmentAccess } from "../lib/auth.ts";
export const reportsRouter = Router();
const filterSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  itemId: z.coerce.number().int().positive().optional(),
  status: z.string().optional(),
  group: z.enum(["detail", "day", "month"]).optional(),
  days: z.coerce.number().int().min(1).max(3650).optional(),
});
function parseFilters(req: Request): ReportFilters {
  const input = validate(filterSchema, req.query);
  if (input.departmentId) assertDepartmentAccess(req.user!, input.departmentId);
  return input;
}
reportsRouter.get(
  "/reports/types",
  requirePermission("reports.view"),
  (_req, res) => {
    res.json({ items: REPORT_TYPES });
  },
);
reportsRouter.get(
  "/reports/:type",
  requirePermission("reports.view"),
  asyncHandler(async (req, res) => {
    const type = String(req.params.type);
    if (!REPORT_TYPES.some((item) => item.type === type)) {
      res.status(404).json({ error: "Jenis laporan tidak dikenal." });
      return;
    }
    const filters = parseFilters(req);
    const report = buildReport(req.user!, type, filters);
    res.json(report);
  }),
);
reportsRouter.get(
  "/reports/:type/export",
  requirePermission("reports.export"),
  asyncHandler(async (req, res) => {
    const type = String(req.params.type);
    if (!REPORT_TYPES.some((item) => item.type === type)) {
      res.status(404).json({ error: "Jenis laporan tidak dikenal." });
      return;
    }
    const format = String(req.query.format ?? "xlsx").toLowerCase();
    if (!["xlsx", "pdf"].includes(format)) {
      res.status(422).json({ error: "Format ekspor harus xlsx atau pdf." });
      return;
    }
    const filters = parseFilters(req);
    const report = buildReport(req.user!, type, filters);
    const stamp = new Date().toISOString().slice(0, 10);
    const baseName = `laporan-${type}-${stamp}`;
    if (format === "xlsx") {
      const buffer = await reportToExcel(report);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${baseName}.xlsx"`,
      );
      res.send(buffer);
    } else {
      const buffer = await reportToPdf(report);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${baseName}.pdf"`,
      );
      res.send(buffer);
    }
  }),
);
