export function parseDateToIso(input: unknown): string | null {
  if (input === null || input === undefined || input === "") return null;
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    return toDateIso(input);
  }
  const raw = String(input).trim();
  if (!raw) return null;

  // ISO / yyyy-mm-dd (sertakan waktu bila ada)
  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
  if (match)
    return buildDate(Number(match[1]), Number(match[2]), Number(match[3]));

  // dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy
  match = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})(?:[ T].*)?$/);
  if (match)
    return buildDate(Number(match[3]), Number(match[2]), Number(match[1]));

  // yyyy/mm/dd
  match = raw.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (match)
    return buildDate(Number(match[1]), Number(match[2]), Number(match[3]));

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return toDateIso(parsed);
  return null;
}

function buildDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

export function toDateIso(date: Date): string {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
    .toISOString()
    .slice(0, 10);
}

/** Angka dari Excel/CSV dengan pemisah ribuan/desimal Indonesia maupun Inggris. */
export function parseNumber(input: unknown): number | null {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  let raw = String(input).trim().replace(/\s/g, "");
  if (!raw) return null;
  raw = raw.replace(/[^0-9.,\-]/g, "");
  if (!raw) return null;

  const negative = raw.startsWith("-");
  raw = raw.replace(/-/g, "");

  const hasDot = raw.includes(".");
  const hasComma = raw.includes(",");
  if (hasDot && hasComma) {
    if (raw.lastIndexOf(",") > raw.lastIndexOf(".")) {
      raw = raw.replace(/\./g, "").replace(",", ".");
    } else {
      raw = raw.replace(/,/g, "");
    }
  } else if (hasComma) {
    const parts = raw.split(",");
    if (
      parts.length > 2 ||
      (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3)
    ) {
      raw = raw.replace(/,/g, "");
    } else {
      raw = raw.replace(",", ".");
    }
  } else if (hasDot) {
    const parts = raw.split(".");
    if (
      parts.length > 2 ||
      (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3)
    ) {
      raw = raw.replace(/\./g, "");
    }
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

export function roundQty(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

export function normalizeHeader(input: string): string {
  return input.toLowerCase().trim().replace(/\s+/g, " ");
}

export function formatNumber(
  value: number | null | undefined,
  maxFraction = 2,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: maxFraction,
  }).format(value);
}

export function formatDateId(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value.length <= 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function monthRange(month: string): { from: string; to: string } {
  const [year, mon] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, (mon ?? 1) - 1, 1));
  const end = new Date(Date.UTC(year, mon ?? 1, 0));
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

export function daysBetween(from: string, to: string): number {
  return Math.floor(
    (new Date(`${to}T00:00:00Z`).getTime() -
      new Date(`${from}T00:00:00Z`).getTime()) /
      86_400_000,
  );
}

export function todayLocal(timeZone = "Asia/Jakarta"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}
