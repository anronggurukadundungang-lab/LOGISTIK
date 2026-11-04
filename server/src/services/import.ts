import crypto from "node:crypto";
import ExcelJS from "exceljs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
// Muat worker pdfjs di thread utama: dengan menaruh WorkerMessageHandler di
// globalThis, fake worker pdfjs tidak perlu meng-import file pdf.worker.mjs
// (yang tidak tersedia pada bundle serverless single-file).
// @ts-expect-error modul worker pdfjs tidak menyertakan deklarasi tipe
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";
(globalThis as Record<string, unknown>).pdfjsWorker = pdfjsWorker;
import type { DatabaseSync } from "../db.ts";
import { getDb, nowIso, withTx } from "../db.ts";
import { ApiError, ValidationError } from "../lib/http.ts";
import { writeAudit, type AuthUser } from "../lib/auth.ts";
import {
  normalizeHeader,
  parseDateToIso,
  parseNumber,
  roundQty,
} from "../lib/utils.ts";
import { postEntryTx, unitCode } from "./stock.ts";

export const CANONICAL_FIELDS = [
  { key: "doc_number", label: "Nomor Dokumen / Transaksi", required: false },
  { key: "line_number", label: "Nomor Baris / Item", required: false },
  { key: "date", label: "Tanggal Pengeluaran", required: true },
  { key: "item_code", label: "Kode Barang", required: false },
  { key: "item_name", label: "Nama Barang", required: false },
  { key: "department_code", label: "Kode Bagian Penerima", required: false },
  { key: "department_name", label: "Nama Bagian Penerima", required: false },
  { key: "unit", label: "Satuan", required: false },
  { key: "qty_requested", label: "Qty Diminta", required: false },
  { key: "qty_approved", label: "Qty Disetujui", required: false },
  { key: "qty_issued", label: "Qty Keluar (wajib)", required: true },
  { key: "notes", label: "Keterangan", required: false },
] as const;

export type Mapping = Record<string, string>;

const ALIASES: Record<string, string[]> = {
  doc_number: [
    "no dokumen",
    "nomor dokumen",
    "no transaksi",
    "nomor transaksi",
    "no pengeluaran",
    "nomor pengeluaran",
    "id transaksi",
    "kode transaksi",
    "no bukti",
    "nomor bukti",
    "no keluar",
    "no pengeluaran barang",
  ],
  line_number: [
    "no baris",
    "nomor baris",
    "baris",
    "line",
    "line no",
    "no item",
    "item no",
    "no urut",
  ],
  date: [
    "tanggal",
    "tgl",
    "tanggal keluar",
    "tanggal transaksi",
    "tanggal pengeluaran",
    "tgl keluar",
    "tgl transaksi",
    "date",
    "tanggal barang keluar",
  ],
  item_code: [
    "kode barang",
    "kode item",
    "kode brg",
    "kd barang",
    "kd brg",
    "item code",
    "kode",
    "id barang",
  ],
  item_name: [
    "nama barang",
    "nama item",
    "nama brg",
    "barang",
    "item",
    "nama",
    "uraian barang",
    "deskripsi barang",
  ],
  department_code: [
    "kode bagian",
    "kode unit",
    "kode tujuan",
    "kode bagian penerima",
    "kode dept",
    "kode departemen",
  ],
  department_name: [
    "bagian",
    "bagian penerima",
    "tujuan",
    "unit",
    "departemen",
    "nama bagian",
    "penerima",
    "divisi",
    "bidang",
  ],
  unit: ["satuan", "unit", "uom", "sat", "satuan barang"],
  qty_requested: [
    "qty diminta",
    "jumlah diminta",
    "jumlah permintaan",
    "qty permintaan",
    "qty request",
    "permintaan",
    "jumlah request",
    "qty request",
  ],
  qty_approved: [
    "qty disetujui",
    "jumlah disetujui",
    "disetujui",
    "qty approve",
    "jumlah approve",
  ],
  qty_issued: [
    "qty keluar",
    "jumlah keluar",
    "jumlah",
    "qty",
    "quantity",
    "qty pengeluaran",
    "jumlah pengeluaran",
    "keluar",
    "qty issued",
    "jumlah barang keluar",
    "total keluar",
  ],
  notes: ["keterangan", "catatan", "notes", "remark", "keterangan tambahan"],
};

function normName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function headerScore(headers: string[]): number {
  let score = 0;
  for (const field of Object.keys(ALIASES)) {
    if (
      headers.some((header) => ALIASES[field].includes(normalizeHeader(header)))
    )
      score += 1;
  }
  return score;
}

function cellValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number") {
    return typeof value === "string" ? value.trim() : value;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text.trim();
    if (obj.result !== undefined) return cellValue(obj.result);
    if (obj.richText && Array.isArray(obj.richText)) {
      return (obj.richText as Array<{ text: string }>)
        .map((part) => part.text)
        .join("")
        .trim();
    }
    if (typeof obj.hyperlink === "string") return obj.hyperlink;
  }
  return String(value).trim();
}

function uniqueHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header, index) => {
    const base = header || `Kolom ${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "");
  const firstLine = clean.split(/\r?\n/).find((line) => line.trim()) ?? "";
  const delimiters = [",", ";", "\t", "|"];
  let delimiter = ",";
  let best = -1;
  for (const candidate of delimiters) {
    const count = firstLine.split(candidate).length;
    if (count > best) {
      best = count;
      delimiter = candidate;
    }
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    if (inQuotes) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field.trim());
      field = "";
    } else if (char === "\n") {
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
    } else if (char === "\r") {
      // abaikan
    } else {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field.trim());
    rows.push(row);
  }
  return rows.filter((item) => item.some((cell) => cell !== ""));
}

interface PdfTextItem {
  str: string;
  x: number;
  y: number;
}

function pdfCellText(items: PdfTextItem[]): string {
  return items
    .sort((left, right) => right.y - left.y)
    .map((item) => item.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Ambil kode dan nama bagian penerima dari blok metadata PDF SIMDONDAR.
 * Contoh layout: "Penerima : 731120220013" lalu ": SERVICE DONOR" pada baris berikutnya.
 */
function extractPdfDepartment(items: PdfTextItem[]): {
  code: string;
  name: string;
} {
  const labels = items.filter((item) =>
    /^(penerima|bagian penerima|tujuan|divisi)$/i.test(item.str),
  );
  for (const label of labels) {
    const sameLine = items
      .filter(
        (item) => Math.abs(item.y - label.y) <= 1 && item.x > label.x,
      )
      .sort((left, right) => left.x - right.x);
    const value =
      sameLine.find((item) => item.str.startsWith(":")) ?? sameLine[0];
    if (!value) continue;

    let text = value.str.replace(/^:\s*/, "").trim();
    if (!text) continue;

    let code = "";
    if (/^[0-9][0-9\s./-]*$/.test(text)) {
      code = text.replace(/\s+/g, " ").trim();
      const below = items
        .filter(
          (item) =>
            item.x >= value.x - 24 &&
            item.x <= value.x + 24 &&
            item.y < label.y &&
            label.y - item.y <= 22 &&
            /[A-Za-z]/.test(item.str),
        )
        .sort((left, right) => right.y - left.y)[0];
      if (below) text = below.str.replace(/^:\s*/, "").trim();
    }

    if (/[A-Za-z]/.test(text)) return { code, name: text };
  }

  const fallback = items
    .filter((item) => /^:\s*\S*[A-Za-z]/.test(item.str))
    .sort((left, right) => right.y - left.y)[0];
  return {
    code: "",
    name: fallback ? fallback.str.replace(/^:\s*/, "").trim() : "",
  };
}

async function parseSimdondarPdf(buffer: Buffer): Promise<Array<Array<string | number | null>>> {
  // Worker pdfjs dimuat via globalThis (lihat import di atas) — opsi tambahan
// tidak diperlukan di sini.
const document = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pageItems: PdfTextItem[][] = [];
  const allText: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = content.items
      .filter((item): item is typeof item & { str: string; transform: number[] } => "str" in item)
      .map((item) => ({
        str: item.str.trim(),
        x: Math.round(item.transform[4]),
        y: Math.round(item.transform[5]),
      }))
      .filter((item) => item.str);
    pageItems.push(items);
    allText.push(...items.map((item) => item.str));
  }

  const joined = allText.join(" ");
  const transactionNumber =
    joined.match(/Nomor\s+Transaksi\s*:\s*([A-Z0-9./-]+)/i)?.[1] ??
    joined.match(/\bIO[A-Z0-9]+\b/i)?.[0] ??
    "";
  const transactionDate =
    parseDateToIso(
      joined.match(
        /Tanggal\s*:\s*(\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4})/i,
      )?.[1] ?? "",
    ) ?? "";
  const department = extractPdfDepartment(pageItems.flat());
  const rows: Array<Array<string | number | null>> = [];

  pageItems.forEach((items) => {
    const rowNumbers = items.filter(
      (item) => /^\d+$/.test(item.str) && item.x >= 60 && item.x <= 84,
    );
    rowNumbers.forEach((rowNumber, index) => {
      const anchorY = rowNumber.y;
      const nearestRowDistance = (item: PdfTextItem): number =>
        Math.min(
          ...rowNumbers.map((candidate) => Math.abs(candidate.y - item.y)),
        );
      const belongsToRow = (item: PdfTextItem): boolean => {
        const nearestRow = rowNumbers.find(
          (candidate) =>
            Math.abs(candidate.y - item.y) === nearestRowDistance(item),
        );
        return nearestRow?.y === anchorY && nearestRowDistance(item) <= 12;
      };
      const rowItems = (xMin: number, xMax: number, tolerance: number) =>
        pdfCellText(
          items.filter(
            (item) =>
              item.x >= xMin &&
              item.x <= xMax &&
              Math.abs(item.y - anchorY) <= tolerance,
          ),
        );

      const code = rowItems(80, 136, 3);
      if (!code) return;
      const name = pdfCellText(
        items.filter(
          (item) => item.x >= 136 && item.x <= 260 && belongsToRow(item),
        ),
      );
      const unit = pdfCellText(
        items.filter(
          (item) => item.x >= 408 && item.x <= 455 && belongsToRow(item),
        ),
      );
      const requested = rowItems(330, 367, 4);
      const issued = rowItems(367, 408, 4);

      rows.push([
        String(index + 1),
        transactionNumber,
        String(rowNumber.str),
        transactionDate,
        department.code,
        department.name,
        code,
        name,
        unit,
        requested,
        issued,
      ]);
    });
  });

  if (!rows.length) {
    throw new ValidationError("PDF tidak dikenali sebagai laporan pengeluaran SIMDONDAR atau tidak memiliki baris barang.");
  }
  // Kolom Harga @ (Rp.) dan Total (Rp.) sengaja tidak diambil.
  return [[
    "Nomor Urut",
    "Nomor Dokumen",
    "Nomor Baris",
    "Tanggal Pengeluaran",
    "Kode Bagian Penerima",
    "Nama Bagian Penerima",
    "Kode Barang",
    "Nama Barang",
    "Satuan",
    "Qty Diminta",
    "Qty Keluar",
  ], ...rows];
}

export async function parseFileBuffer(
  buffer: Buffer,
  filename: string,
): Promise<{
  headers: string[];
  rows: Record<string, string | number | null>[];
}> {
  const ext = filename.toLowerCase().split(".").pop();
  let matrix: Array<Array<string | number | null>>;

  if (ext === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet)
      throw new ValidationError("File Excel tidak memiliki worksheet.");
    matrix = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values as Array<unknown>;
      matrix.push(values.slice(1).map((value) => cellValue(value)));
    });
  } else if (ext === "csv") {
    matrix = parseCsv(buffer.toString("utf8"));
  } else if (ext === "pdf") {
    matrix = await parseSimdondarPdf(buffer);
  } else {
    throw new ValidationError("Format file harus .xlsx, .csv, atau .pdf.");
  }

  if (matrix.length < 2)
    throw new ValidationError(
      "File tidak berisi data (minimal baris judul dan satu baris data).",
    );

  // Cari baris header terbaik pada 10 baris pertama (mendukung laporan dengan judul di atas header).
  let headerIndex = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(10, matrix.length); i += 1) {
    const row = matrix[i];
    if (!row || !row.some((cell) => String(cell ?? "").trim())) continue;
    const score = headerScore(row.map((cell) => String(cell ?? "").trim()));
    if (score > bestScore) {
      bestScore = score;
      headerIndex = i;
    }
    if (score >= 3) break;
  }
  if (bestScore < 1) headerIndex = 0;

  const headerRow = matrix[headerIndex] ?? [];
  const headers = uniqueHeaders(
    headerRow.map((cell) => String(cell ?? "").trim()),
  );
  const rows: Record<string, string | number | null>[] = [];
  for (let i = headerIndex + 1; i < matrix.length; i += 1) {
    const values = matrix[i] ?? [];
    if (!values.some((cell) => cell !== null && cell !== "")) continue;
    const record: Record<string, string | number | null> = {};
    headers.forEach((header, index) => {
      record[header] = values[index] ?? null;
    });
    rows.push(record);
  }
  if (!rows.length)
    throw new ValidationError(
      "File tidak memiliki baris data setelah judul kolom.",
    );
  return { headers, rows };
}

export function suggestMapping(headers: string[]): Mapping {
  const mapping: Mapping = {};
  const normalized = headers.map((header) => ({
    header,
    norm: normalizeHeader(header),
  }));
  const used = new Set<string>();
  for (const field of Object.keys(ALIASES)) {
    const aliases = ALIASES[field];
    let found = normalized.find(
      (item) => !used.has(item.header) && aliases.includes(item.norm),
    );
    if (!found) {
      found = normalized.find(
        (item) =>
          !used.has(item.header) &&
          aliases.some(
            (alias) => item.norm.includes(alias) || alias.includes(item.norm),
          ),
      );
    }
    mapping[field] = found?.header ?? "";
    if (found) used.add(found.header);
  }
  return mapping;
}

export function validateMapping(mapping: Mapping, headers: string[]): void {
  for (const field of ["date", "qty_issued"]) {
    if (!mapping[field]) {
      const label =
        CANONICAL_FIELDS.find((item) => item.key === field)?.label ?? field;
      throw new ValidationError(`Kolom "${label}" wajib dipetakan.`);
    }
  }
  if (!mapping.item_code && !mapping.item_name) {
    throw new ValidationError(
      "Petakan minimal salah satu: Kode Barang atau Nama Barang.",
    );
  }
  if (!mapping.department_code && !mapping.department_name) {
    throw new ValidationError(
      "Petakan minimal salah satu: Kode Bagian atau Nama Bagian Penerima.",
    );
  }
  for (const [key, header] of Object.entries(mapping)) {
    if (header && !headers.includes(header)) {
      throw new ValidationError(
        `Kolom "${header}" untuk ${key} tidak ditemukan pada file.`,
      );
    }
  }
}

interface RawValue {
  [key: string]: string | number | null;
}

interface ParsedRow {
  docNumber: string | null;
  lineNumber: string | null;
  date: string;
  itemId: number;
  itemName: string;
  departmentId: number;
  departmentName: string;
  unitId: number;
  unitLabel: string;
  qtyRequested: number | null;
  qtyApproved: number | null;
  qtyIssued: number;
  qtyIssuedSource: number;
  notes: string | null;
  identity: string;
  fingerprint: string;
  warnings: string[];
  errors: string[];
  status: "VALID" | "WARNING" | "ERROR" | "DUPLICATE";
}

function getRaw(row: RawValue, mapping: Mapping, key: string): string {
  const header = mapping[key];
  if (!header) return "";
  const value = row[header];
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

interface AutoCreateStats {
  items: number;
  departments: number;
}

interface AutoCreateContext {
  actor: AuthUser;
  stats: AutoCreateStats;
}

/** Cari kode auto-increment berikutnya (contoh: BRG-000007) untuk master yang dikosongkan. */
function nextAutoCode(
  tx: DatabaseSync,
  table: "items" | "departments",
  prefix: string,
): string {
  const rows = tx
    .prepare(`SELECT code FROM ${table} WHERE code LIKE ?`)
    .all(`${prefix}-%`) as Array<{ code: string }>;
  let max = 0;
  for (const row of rows) {
    const num = Number(row.code.slice(prefix.length + 1));
    if (Number.isInteger(num) && num > max) max = num;
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

/** Satuan dasar default untuk barang yang dibuat otomatis: PCS bila ada, selain itu satuan aktif pertama. */
function findDefaultUnitId(tx: DatabaseSync): number | null {
  const pcs = tx
    .prepare(
      "SELECT id FROM units WHERE UPPER(code) = 'PCS' AND is_active = 1 LIMIT 1",
    )
    .get() as { id: number } | undefined;
  if (pcs) return pcs.id;
  const any = tx
    .prepare("SELECT id FROM units WHERE is_active = 1 ORDER BY id LIMIT 1")
    .get() as { id: number } | undefined;
  return any?.id ?? null;
}

function findDepartment(
  tx: DatabaseSync,
  code: string,
  name: string,
  errors: string[],
  warnings: string[],
  autoCreate?: AutoCreateContext,
) {
  if (code) {
    const byCode = tx
      .prepare(
        "SELECT id, name FROM departments WHERE LOWER(COALESCE(simdondar_code, '')) = LOWER(?) OR LOWER(code) = LOWER(?)",
      )
      .get(code, code) as { id: number; name: string } | undefined;
    if (byCode) {
      if (name && normName(name) !== normName(byCode.name)) {
        warnings.push(
          `Nama bagian "${name}" berbeda dari master "${byCode.name}" (kode ${code}); memakai kode.`,
        );
      }
      return byCode;
    }
  }
  if (name) {
    const target = normName(name);
    const all = tx.prepare("SELECT id, name FROM departments").all() as Array<{
      id: number;
      name: string;
    }>;
    const exact = all.find((dept) => normName(dept.name) === target);
    if (exact) return exact;
    if (autoCreate) {
      const now = nowIso();
      const deptCode = code?.trim() || nextAutoCode(tx, "departments", "DEPT");
      try {
        const inserted = tx
          .prepare(
            `INSERT INTO departments (code, simdondar_code, name, is_active, created_at, updated_at)
             VALUES (?, ?, ?, 1, ?, ?)`,
          )
          .run(deptCode, code?.trim() || null, name, now, now);
        const id = Number(inserted.lastInsertRowid);
        autoCreate.stats.departments += 1;
        warnings.push(
          `Bagian "${name}" belum ada di master; dibuat otomatis (kode ${deptCode}).`,
        );
        writeAudit(tx, {
          actor: autoCreate.actor,
          action: "AUTO_CREATE_DEPARTMENT",
          entityType: "departments",
          entityId: id,
          after: { code: deptCode, simdondar_code: code?.trim() || null, name },
          reason: "Auto-create saat impor SIMDONDAR.",
        });
        return { id, name };
      } catch (error) {
        errors.push(
          `Bagian "${name}" gagal dibuat otomatis: ${(error as Error).message}`,
        );
        return null;
      }
    }
    errors.push(`Bagian "${name}" tidak ditemukan pada master bagian.`);
    return null;
  }
  if (code) {
    errors.push(
      `Bagian kode "${code}" tidak ditemukan pada master dan tidak ada nama untuk auto-create.`,
    );
  } else {
    errors.push("Kode/nama bagian penerima tidak tersedia.");
  }
  return null;
}

function findItem(
  tx: DatabaseSync,
  code: string,
  name: string,
  errors: string[],
  warnings: string[],
  autoCreate?: AutoCreateContext & { baseUnitId: number | null },
): { id: number; name: string; base_unit_id: number; autocreated: boolean } | null {
  if (code) {
    const byCode = tx
      .prepare(
        "SELECT id, name, base_unit_id FROM items WHERE LOWER(COALESCE(simdondar_code, '')) = LOWER(?) OR LOWER(code) = LOWER(?)",
      )
      .get(code, code) as
      | { id: number; name: string; base_unit_id: number }
      | undefined;
    if (byCode) {
      if (name && normName(name) !== normName(byCode.name)) {
        warnings.push(
          `Nama barang "${name}" berbeda dari master "${byCode.name}" (kode ${code}); memakai kode.`,
        );
      }
      return { ...byCode, autocreated: false };
    }
  }
  if (name) {
    const target = normName(name);
    const all = tx
      .prepare("SELECT id, name, base_unit_id FROM items")
      .all() as Array<{
      id: number;
      name: string;
      base_unit_id: number;
    }>;
    const exact = all.find((item) => normName(item.name) === target);
    if (exact) return { ...exact, autocreated: false };
    if (autoCreate) {
      if (!autoCreate.baseUnitId) {
        errors.push(
          `Barang "${name}" belum ada di master dan tidak ada satuan dasar tersedia untuk pembuatan otomatis. Tetapkan satuan pada kolom Satuan atau master satuan.`,
        );
        return null;
      }
      const now = nowIso();
      const itemCode = code?.trim() || nextAutoCode(tx, "items", "BRG");
      try {
        const inserted = tx
          .prepare(
            `INSERT INTO items (code, simdondar_code, name, base_unit_id, min_stock, track_batch, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, 0, 0, 1, ?, ?)`,
          )
          .run(
            itemCode,
            code?.trim() || null,
            name,
            autoCreate.baseUnitId,
            now,
            now,
          );
        const id = Number(inserted.lastInsertRowid);
        autoCreate.stats.items += 1;
        warnings.push(
          `Barang "${name}" belum ada di master; dibuat otomatis (kode ${itemCode}, satuan dasar ${unitCode(tx, autoCreate.baseUnitId)}).`,
        );
        writeAudit(tx, {
          actor: autoCreate.actor,
          action: "AUTO_CREATE_ITEM",
          entityType: "items",
          entityId: id,
          after: {
            code: itemCode,
            simdondar_code: code?.trim() || null,
            name,
            base_unit_id: autoCreate.baseUnitId,
          },
          reason: "Auto-create saat impor SIMDONDAR.",
        });
        return {
          id,
          name,
          base_unit_id: autoCreate.baseUnitId,
          autocreated: true,
        };
      } catch (error) {
        errors.push(
          `Barang "${name}"${code ? ` (kode ${code})` : ""} gagal dibuat otomatis: ${(error as Error).message}`,
        );
        return null;
      }
    }
    errors.push(
      `Barang "${name}"${code ? ` (kode ${code})` : ""} belum ada di master barang. Tambahkan barang atau perbaiki pemetaan.`,
    );
    return null;
  }
  if (code) {
    errors.push(
      `Barang kode "${code}" tidak ditemukan pada master dan tidak ada nama untuk auto-create.`,
    );
  } else {
    errors.push("Kode/nama barang tidak tersedia.");
  }
  return null;
}

function validateRow(
  tx: DatabaseSync,
  raw: RawValue,
  mapping: Mapping,
  rowNumber: number,
  autoCreate?: { item?: AutoCreateContext; department?: AutoCreateContext },
): ParsedRow {
  const warnings: string[] = [];
  const errors: string[] = [];

  const dateRaw = getRaw(raw, mapping, "date");
  const date = parseDateToIso(dateRaw);
  if (!date) errors.push(`Tanggal "${dateRaw || "(kosong)"}" tidak valid.`);

  const itemCode = getRaw(raw, mapping, "item_code");
  const itemName = getRaw(raw, mapping, "item_name");
  const unitRaw = getRaw(raw, mapping, "unit");
  const resolvedUnit = unitRaw
    ? (tx
        .prepare(
          "SELECT id, code FROM units WHERE LOWER(code) = LOWER(?) OR LOWER(name) = LOWER(?)",
        )
        .get(unitRaw, unitRaw) as { id: number; code: string } | undefined) ??
      null
    : null;
  const item = findItem(
    tx,
    itemCode,
    itemName,
    errors,
    warnings,
    autoCreate?.item
      ? {
          actor: autoCreate.item.actor,
          baseUnitId: resolvedUnit?.id ?? findDefaultUnitId(tx),
          stats: autoCreate.item.stats,
        }
      : undefined,
  );

  const deptCode = getRaw(raw, mapping, "department_code");
  const deptName = getRaw(raw, mapping, "department_name");
  const department = findDepartment(
    tx,
    deptCode,
    deptName,
    errors,
    warnings,
    autoCreate?.department,
  );

  let unitId = item?.base_unit_id ?? 0;
  let unitLabel = item ? unitCode(tx, item.base_unit_id) : unitRaw;
  let factor = 1;
  if (item) {
    if (unitRaw) {
      if (!resolvedUnit) {
        if (item.autocreated) {
          warnings.push(
            `Satuan "${unitRaw}" tidak dikenali; memakai satuan dasar ${unitCode(tx, item.base_unit_id)}.`,
          );
        } else {
          errors.push(`Satuan "${unitRaw}" tidak dikenali pada master satuan.`);
        }
      } else if (resolvedUnit.id !== item.base_unit_id) {
        const conversion = tx
          .prepare(
            "SELECT factor FROM item_unit_conversions WHERE item_id = ? AND from_unit_id = ?",
          )
          .get(item.id, resolvedUnit.id) as { factor: number } | undefined;
        if (!conversion) {
          errors.push(
            `Satuan "${unitRaw}" belum memiliki konversi ke satuan dasar untuk barang ini. Atur konversi pada master barang.`,
          );
        } else {
          factor = conversion.factor;
          unitLabel = resolvedUnit.code;
          warnings.push(
            `Qty ${unitRaw} dikonversi ke ${unitCode(tx, item.base_unit_id)} (faktor ${conversion.factor}).`,
          );
        }
      }
    } else {
      warnings.push(
        `Satuan tidak tersedia; memakai satuan dasar ${unitCode(tx, item.base_unit_id)}.`,
      );
    }
  }

  const qtyIssuedRaw = getRaw(raw, mapping, "qty_issued");
  const qtyIssuedSource = parseNumber(qtyIssuedRaw);
  if (
    qtyIssuedSource === null ||
    !Number.isFinite(qtyIssuedSource) ||
    qtyIssuedSource <= 0
  ) {
    errors.push(
      `Qty keluar "${qtyIssuedRaw || "(kosong)"}" harus berupa angka lebih dari 0.`,
    );
  }
  const qtyRequested = parseNumber(getRaw(raw, mapping, "qty_requested"));
  if (qtyRequested !== null && qtyRequested < 0)
    errors.push("Qty diminta tidak boleh negatif.");
  const qtyApproved = parseNumber(getRaw(raw, mapping, "qty_approved"));
  if (qtyApproved !== null && qtyApproved < 0)
    errors.push("Qty disetujui tidak boleh negatif.");

  const docNumber = getRaw(raw, mapping, "doc_number") || null;
  const lineNumber = getRaw(raw, mapping, "line_number") || null;
  const notes = getRaw(raw, mapping, "notes") || null;

  const baseQty =
    qtyIssuedSource !== null ? roundQty(qtyIssuedSource * factor) : 0;
  const fingerprintData = [
    date ?? "",
    item?.id ?? (itemCode || itemName),
    department?.id ?? (deptCode || deptName),
    baseQty,
    unitId,
    docNumber ?? "",
    lineNumber ?? "",
    notes ?? "",
  ].join("|");
  const fingerprint = crypto
    .createHash("sha256")
    .update(fingerprintData)
    .digest("hex");
  const identity = docNumber
    ? `doc:${docNumber}|line:${lineNumber ?? `row-${rowNumber}`}`
    : `fp:${fingerprint}`;

  const parsed: ParsedRow = {
    docNumber,
    lineNumber,
    date: date ?? "",
    itemId: item?.id ?? 0,
    itemName: item?.name ?? itemName,
    departmentId: department?.id ?? 0,
    departmentName: department?.name ?? deptName,
    unitId: item?.base_unit_id ?? unitId,
    unitLabel,
    qtyRequested,
    qtyApproved,
    qtyIssued: baseQty,
    qtyIssuedSource: qtyIssuedSource ?? 0,
    notes,
    identity,
    fingerprint,
    warnings,
    errors,
    status: errors.length ? "ERROR" : warnings.length ? "WARNING" : "VALID",
  };

  if (docNumber && !lineNumber) {
    parsed.warnings.push(
      "Nomor baris tidak tersedia; identitas memakai nomor baris file.",
    );
    if (parsed.status === "VALID") parsed.status = "WARNING";
  }

  if (errors.length) return parsed;

  const existing = tx
    .prepare("SELECT id FROM simdondar_transactions WHERE source_identity = ?")
    .get(identity) as { id: number } | undefined;
  if (existing) {
    parsed.status = "DUPLICATE";
    parsed.warnings.push(
      `Transaksi identitas ${identity} sudah pernah diimpor (ID ${existing.id}).`,
    );
  }
  return parsed;
}

export function validateBatch(
  user: AuthUser,
  batchId: number,
  mapping: Mapping,
  meta: { ip?: string; userAgent?: string },
  options: { autoCreate?: boolean } = {},
) {
  return withTx((tx) => {
    const autoCreate = options.autoCreate ?? false;
    const stats: AutoCreateStats = { items: 0, departments: 0 };
    const itemAutoCreate: AutoCreateContext | undefined =
      autoCreate && user.permissions.includes("items.manage")
        ? { actor: user, stats }
        : undefined;
    const departmentAutoCreate: AutoCreateContext | undefined =
      autoCreate && user.permissions.includes("departments.manage")
        ? { actor: user, stats }
        : undefined;

    const batch = tx
      .prepare("SELECT * FROM simdondar_import_batches WHERE id = ?")
      .get(batchId) as
      | {
          id: number;
          status: string;
          original_headers_json: string;
          created_by: number;
        }
      | undefined;
    if (!batch) throw new ValidationError("Batch impor tidak ditemukan.");
    if (batch.status === "COMMITTED")
      throw new ValidationError(
        "Batch ini sudah di-commit dan tidak dapat divalidasi ulang.",
      );
    if (batch.status === "CANCELLED")
      throw new ValidationError("Batch ini dibatalkan.");

    const headers = JSON.parse(batch.original_headers_json) as string[];
    validateMapping(mapping, headers);

    const rows = tx
      .prepare(
        "SELECT * FROM simdondar_import_rows WHERE batch_id = ? ORDER BY row_number",
      )
      .all(batchId) as Array<{
      id: number;
      row_number: number;
      raw_json: string;
    }>;

    const counts = { valid: 0, warning: 0, error: 0, duplicate: 0 };
    const seenIdentity = new Map<string, number>();
    let sequence = 0;

    for (const row of rows) {
      sequence += 1;
      const raw = JSON.parse(row.raw_json) as RawValue;
      const parsed = validateRow(tx, raw, mapping, row.row_number, {
        item: itemAutoCreate,
        department: departmentAutoCreate,
      });
      if (parsed.status !== "ERROR" && parsed.status !== "DUPLICATE") {
        const seen = seenIdentity.get(parsed.identity);
        if (seen) {
          parsed.status = "DUPLICATE";
          parsed.warnings.push(
            `Duplikat dengan baris ${seen} di file yang sama.`,
          );
        } else {
          seenIdentity.set(parsed.identity, row.row_number);
        }
      }
      if (parsed.status === "VALID") counts.valid += 1;
      else if (parsed.status === "WARNING") counts.warning += 1;
      else if (parsed.status === "DUPLICATE") counts.duplicate += 1;
      else counts.error += 1;

      tx.prepare(
        `UPDATE simdondar_import_rows
            SET status = ?, parsed_json = ?, errors_json = ?, warnings_json = ?, fingerprint = ?, identity = ?
          WHERE id = ?`,
      ).run(
        parsed.status,
        JSON.stringify(parsed),
        JSON.stringify(parsed.errors),
        JSON.stringify(parsed.warnings),
        parsed.fingerprint,
        parsed.identity,
        row.id,
      );
    }

    const now = nowIso();
    tx.prepare(
      `UPDATE simdondar_import_batches
          SET mapping_json = ?, status = 'VALIDATED', total_rows = ?, valid_rows = ?, warning_rows = ?,
              error_rows = ?, duplicate_rows = ?, auto_create = ?, validated_at = ?
        WHERE id = ?`,
    ).run(
      JSON.stringify(mapping),
      rows.length,
      counts.valid,
      counts.warning,
      counts.error,
      counts.duplicate,
      autoCreate ? 1 : 0,
      now,
      batchId,
    );

    tx.prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('import_mapping', ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    ).run(JSON.stringify(mapping), now, user.id);

    writeAudit(tx, {
      actor: user,
      action: "VALIDATE_IMPORT",
      entityType: "simdondar_import_batches",
      entityId: batchId,
      after: {
        mapping,
        counts,
        total: rows.length,
        autoCreate,
        createdItems: stats.items,
        createdDepartments: stats.departments,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return {
      batchId,
      counts,
      total: rows.length,
      autoCreate,
      createdItems: stats.items,
      createdDepartments: stats.departments,
    };
  });
}

export function getReceiptMode(): "auto" | "confirm" {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = 'receipt_mode'")
    .get() as { value: string } | undefined;
  return row?.value === "auto" ? "auto" : "confirm";
}

export function commitBatch(
  user: AuthUser,
  batchId: number,
  options: { includeSuspects?: boolean; notes?: string | null },
  meta: { ip?: string; userAgent?: string },
) {
  return withTx((tx) => {
    const batch = tx
      .prepare("SELECT * FROM simdondar_import_batches WHERE id = ?")
      .get(batchId) as
      | {
          id: number;
          status: string;
          mapping_json: string | null;
          receipt_mode: string;
          filename: string;
        }
      | undefined;
    if (!batch) throw new ValidationError("Batch impor tidak ditemukan.");
    if (batch.status === "COMMITTED")
      throw new ValidationError("Batch ini sudah pernah di-commit.");
    if (batch.status !== "VALIDATED")
      throw new ValidationError(
        "Validasi batch terlebih dahulu sebelum commit.",
      );

    const receiptMode = getReceiptMode();
    const rows = tx
      .prepare(
        `SELECT * FROM simdondar_import_rows
          WHERE batch_id = ? AND status IN ('VALID','WARNING','DUPLICATE','ERROR')
          ORDER BY row_number`,
      )
      .all(batchId) as Array<{
      id: number;
      row_number: number;
      raw_json: string;
      parsed_json: string | null;
      status: string;
      identity: string | null;
      fingerprint: string | null;
    }>;

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    let awaitingReceipt = 0;
    const importedTransactions: Array<{
      id: number;
      identity: string;
      item: string;
      qty: number;
    }> = [];

    for (const row of rows) {
      if (!row.parsed_json || ["ERROR"].includes(row.status)) {
        failed += 1;
        continue;
      }
      const parsed = JSON.parse(row.parsed_json) as ParsedRow;
      if (parsed.status === "ERROR" || parsed.errors.length) {
        failed += 1;
        continue;
      }

      let identity = parsed.identity;
      const existing = tx
        .prepare(
          "SELECT id FROM simdondar_transactions WHERE source_identity = ?",
        )
        .get(identity) as { id: number } | undefined;
      if (existing) {
        if (!options.includeSuspects || identity.startsWith("doc:")) {
          tx.prepare(
            "UPDATE simdondar_import_rows SET status = 'SKIPPED' WHERE id = ?",
          ).run(row.id);
          skipped += 1;
          continue;
        }
        // Override manual hanya untuk fingerprint (bukan nomor dokumen resmi).
        identity = `fp:${parsed.fingerprint}|override:${batchId}:${row.row_number}`;
      }

      const duplicateInFile = tx
        .prepare(
          "SELECT id FROM simdondar_transactions WHERE source_identity = ?",
        )
        .get(identity) as { id: number } | undefined;
      if (duplicateInFile) {
        tx.prepare(
          "UPDATE simdondar_import_rows SET status = 'SKIPPED' WHERE id = ?",
        ).run(row.id);
        skipped += 1;
        continue;
      }

      const item = tx
        .prepare(
          "SELECT id, name, base_unit_id, is_active FROM items WHERE id = ?",
        )
        .get(parsed.itemId) as
        | { id: number; name: string; base_unit_id: number; is_active: number }
        | undefined;
      const department = tx
        .prepare("SELECT id, name, is_active FROM departments WHERE id = ?")
        .get(parsed.departmentId) as
        | { id: number; name: string; is_active: number }
        | undefined;
      if (!item || !department || !item.is_active || !department.is_active) {
        tx.prepare(
          "UPDATE simdondar_import_rows SET status = 'ERROR', errors_json = ? WHERE id = ?",
        ).run(
          JSON.stringify([
            "Barang/bagian tidak ditemukan atau nonaktif saat commit.",
          ]),
          row.id,
        );
        failed += 1;
        continue;
      }

      const now = nowIso();
      const insert = tx
        .prepare(
          `INSERT INTO simdondar_transactions
            (import_batch_id, import_row_id, source_doc_number, source_line_number, source_identity,
             source_date, department_id, item_id, unit_id, qty_requested, qty_approved, qty_issued,
             status, notes, raw_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          batchId,
          row.id,
          parsed.docNumber,
          parsed.lineNumber,
          identity,
          parsed.date,
          department.id,
          item.id,
          item.base_unit_id,
          parsed.qtyRequested,
          parsed.qtyApproved,
          parsed.qtyIssued,
          "AWAITING_RECEIPT",
          parsed.notes,
          row.raw_json,
          now,
          now,
        );
      const transactionId = Number(insert.lastInsertRowid);

      if (receiptMode === "auto") {
        const entry = postEntryTx(tx, {
          departmentId: department.id,
          itemId: item.id,
          entryType: "RECEIPT",
          qtyDelta: parsed.qtyIssued,
          occurredAt: parsed.date,
          sourceType: "SIMDONDAR",
          sourceId: transactionId,
          sourceRef: parsed.docNumber ?? identity,
          description: `Penerimaan SIMDONDAR${parsed.docNumber ? ` (${parsed.docNumber})` : ""} — impor ${batch.filename}`,
          createdBy: user.id,
        });
        tx.prepare(
          `UPDATE simdondar_transactions
              SET status = 'RECEIVED', qty_received = qty_issued, receipt_entry_id = ?, received_by = ?,
                  received_at = ?, received_note = ?, updated_at = ?
            WHERE id = ?`,
        ).run(
          entry.id,
          user.id,
          now,
          "Otomatis sesuai pengaturan penerimaan.",
          now,
          transactionId,
        );
      } else {
        awaitingReceipt += 1;
      }

      tx.prepare(
        "UPDATE simdondar_import_rows SET status = 'IMPORTED', identity = ?, simdondar_transaction_id = ? WHERE id = ?",
      ).run(identity, transactionId, row.id);
      imported += 1;
      importedTransactions.push({
        id: transactionId,
        identity,
        item: item.name,
        qty: parsed.qtyIssued,
      });
    }

    const completedAt = nowIso();
    tx.prepare(
      `UPDATE simdondar_import_batches
          SET status = 'COMMITTED', receipt_mode = ?, imported_rows = ?, completed_at = ?, notes = ?
        WHERE id = ?`,
    ).run(receiptMode, imported, completedAt, options.notes ?? null, batchId);

    writeAudit(tx, {
      actor: user,
      action: "COMMIT_IMPORT",
      entityType: "simdondar_import_batches",
      entityId: batchId,
      after: {
        filename: batch.filename,
        imported,
        skipped,
        failed,
        awaitingReceipt,
        receiptMode,
        includeSuspects: Boolean(options.includeSuspects),
      },
      reason: options.notes ?? null,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return {
      imported,
      skipped,
      failed,
      awaitingReceipt,
      receiptMode,
      transactions: importedTransactions,
    };
  });
}

export function getBatchPreview(batchId: number, limit = 100) {
  const db = getDb();
  const batch = db
    .prepare(
      `SELECT b.*, u.name AS created_by_name
         FROM simdondar_import_batches b
         JOIN users u ON u.id = b.created_by
        WHERE b.id = ?`,
    )
    .get(batchId) as Record<string, unknown> | undefined;
  if (!batch) throw new ApiError(404, "Batch impor tidak ditemukan.");
  const rows = db
    .prepare(
      `SELECT row_number, status, raw_json, parsed_json, errors_json, warnings_json, identity, simdondar_transaction_id
         FROM simdondar_import_rows WHERE batch_id = ? ORDER BY row_number LIMIT ?`,
    )
    .all(batchId, limit) as Array<Record<string, unknown>>;
  return {
    batch,
    headers: JSON.parse(String(batch.original_headers_json)) as string[],
    rows: rows.map((row) => ({
      rowNumber: row.row_number,
      status: row.status,
      raw: JSON.parse(String(row.raw_json)),
      parsed: row.parsed_json ? JSON.parse(String(row.parsed_json)) : null,
      errors: JSON.parse(String(row.errors_json)),
      warnings: JSON.parse(String(row.warnings_json)),
      identity: row.identity,
      transactionId: row.simdondar_transaction_id,
    })),
  };
}

export async function getImportErrorsWorkbook(
  batchId: number,
): Promise<Buffer> {
  const db = getDb();
  const batch = db
    .prepare("SELECT * FROM simdondar_import_batches WHERE id = ?")
    .get(batchId) as { filename: string } | undefined;
  if (!batch) throw new ApiError(404, "Batch impor tidak ditemukan.");
  const rows = db
    .prepare(
      `SELECT row_number, status, raw_json, errors_json, warnings_json
         FROM simdondar_import_rows
        WHERE batch_id = ? AND status IN ('ERROR','DUPLICATE','WARNING','SKIPPED')
        ORDER BY row_number`,
    )
    .all(batchId) as Array<{
    row_number: number;
    status: string;
    raw_json: string;
    errors_json: string;
    warnings_json: string;
  }>;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Sistem Monitoring Stok";
  const sheet = workbook.addWorksheet("Hasil Impor");
  sheet.columns = [
    { header: "Baris", key: "row", width: 8 },
    { header: "Status", key: "status", width: 14 },
    { header: "Kesalahan", key: "errors", width: 60 },
    { header: "Peringatan", key: "warnings", width: 60 },
    { header: "Data Mentah", key: "raw", width: 100 },
  ];
  for (const row of rows) {
    sheet.addRow({
      row: row.row_number,
      status: row.status,
      errors: (JSON.parse(row.errors_json) as string[]).join(" | "),
      warnings: (JSON.parse(row.warnings_json) as string[]).join(" | "),
      raw: row.raw_json,
    });
  }
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE2E8F0" },
  };
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function buildImportTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Data");
  sheet.columns = [
    { header: "Nomor Dokumen", key: "doc", width: 22 },
    { header: "Nomor Baris", key: "line", width: 12 },
    { header: "Tanggal", key: "date", width: 14 },
    { header: "Kode Barang", key: "itemCode", width: 16 },
    { header: "Nama Barang", key: "itemName", width: 30 },
    { header: "Bagian Penerima", key: "department", width: 28 },
    { header: "Satuan", key: "unit", width: 10 },
    { header: "Qty Diminta", key: "qtyReq", width: 12 },
    { header: "Qty Disetujui", key: "qtyApp", width: 12 },
    { header: "Qty Keluar", key: "qtyOut", width: 12 },
    { header: "Keterangan", key: "notes", width: 30 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFDBEAFE" },
  };
  sheet.addRow({
    doc: "CONTOH-001",
    line: "1",
    date: new Date().toISOString().slice(0, 10),
    itemCode: "BRG-001",
    itemName: "Nama barang sesuai master",
    department: "Aftap",
    unit: "PCS",
    qtyReq: 10,
    qtyApp: 10,
    qtyOut: 10,
    notes: "Baris contoh — hapus sebelum mengunggah",
  });

  const guide = workbook.addWorksheet("Petunjuk");
  guide.columns = [{ header: "Petunjuk", key: "text", width: 100 }];
  guide.addRow({
    text: "1. Satu baris = satu barang pada satu transaksi pengeluaran SIMDONDAR.",
  });
  guide.addRow({
    text: "2. Kolom wajib: Tanggal, Qty Keluar, dan minimal Kode Barang atau Nama Barang, serta Kode/Nama Bagian.",
  });
  guide.addRow({
    text: "3. Nomor Dokumen + Nomor Baris sangat disarankan agar impor idempotent.",
  });
  guide.addRow({
    text: "4. Jangan mengubah nama header jika ingin pemetaan otomatis.",
  });
  guide.addRow({
    text: "5. Hapus baris contoh sebelum mengunggah data sebenarnya.",
  });
  guide.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
