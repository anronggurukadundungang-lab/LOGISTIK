import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodType } from "zod";

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(422, message, details);
  }
}

export function asyncHandler(
  handler: (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

export function validate<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      "Data yang dikirim tidak valid.",
      formatZodError(result.error),
    );
  }
  return result.data;
}

export function formatZodError(
  error: ZodError,
): Array<{ field: string; message: string }> {
  return error.issues.map((issue) => ({
    field: issue.path.length ? issue.path.join(".") : "(root)",
    message: issue.message,
  }));
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ApiError) {
    res.status(error.status).json({
      error: error.message,
      details: error.details ?? null,
    });
    return;
  }
  const anyError = error as { code?: string; message?: string };
  if (
    anyError?.code === "SQLITE_CONSTRAINT_UNIQUE" ||
    anyError?.message?.includes("UNIQUE constraint")
  ) {
    res
      .status(409)
      .json({ error: "Data sudah ada (duplikat).", details: null });
    return;
  }
  if (anyError?.code?.startsWith("SQLITE_CONSTRAINT")) {
    res
      .status(422)
      .json({
        error: "Data melanggar aturan basis data.",
        details: anyError.message,
      });
    return;
  }
  if (!process.env.VITEST) {
    // eslint-disable-next-line no-console
    console.error("[error]", req.method, req.originalUrl, error);
  }
  res
    .status(500)
    .json({ error: "Terjadi kesalahan pada server. Silakan coba lagi." });
}

export interface PageQuery {
  page: number;
  pageSize: number;
  offset: number;
}

export function parsePage(
  query: Record<string, unknown>,
  defaultSize = 20,
): PageQuery {
  const page = Math.max(1, Number.parseInt(String(query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(
    200,
    Math.max(
      1,
      Number.parseInt(String(query.pageSize ?? defaultSize), 10) || defaultSize,
    ),
  );
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function paginated<T>(items: T[], total: number, page: PageQuery) {
  return {
    items,
    pagination: {
      page: page.page,
      pageSize: page.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / page.pageSize)),
    },
  };
}

export function clientIp(req: Request): string {
  return (
    (req.headers["x-forwarded-for"] as string | undefined)
      ?.split(",")[0]
      ?.trim() ||
    req.ip ||
    ""
  );
}
