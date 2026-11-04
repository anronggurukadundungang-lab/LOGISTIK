/**
 * Impor sekali-jalan master barang + satuan + kategori dari DATA BARANG.xlsx.
 *
 * Pemakaian: npm --workspace server run tsx -- src/scripts/import-master-barang.ts [path-xlsx]
 * Path default: <projectRoot>/bahan upload/DATA BARANG.xlsx
 *
 * Aturan (disepakati pemilik data):
 * - Kategori diambil dari kolom "Jenis" dan dibuat bila belum ada.
 * - Satuan dinormalisasi lewat UNIT_FIX di bawah (satuan kotor hasil input manual).
 * - Kolom "Stok" dan "Isi" diabaikan: master saja, tanpa saldo awal dan tanpa konversi.
 * - Barang yang sudah ada (kode sama) diperbarui: nama, satuan dasar, stok minimum.
 */
import path from "node:path";
import ExcelJS from "exceljs";
import { getDb, nowIso } from "../db.ts";
import { config } from "../config.ts";
import { writeAudit } from "../lib/auth.ts";

/** Normalisasi satuan tidak wajar pada kolom "Satuan". */
const UNIT_FIX: Record<string, string> = {
  "1": "PCS",
  "0": "PCS",
  "UNIT`": "UNIT",
  ZACK: "PCS", // merk kertas yang salah kolom
  "PAPER ONE": "PCS", // merk kertas yang salah kolom
  "IKAT/BUNGKUS": "BUNGKUS",
  "IKAT/BLOK": "BLOK",
  "CUP KALENG": "KALENG",
  "VIAL/KIT": "VIAL",
  DOS: "DUS", // typo umum DUS
};

function titleCase(code: string): string {
  return code
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

interface Row {
  code: string;
  name: string;
  jenis: string;
  unit: string;
  unitRaw: string;
  minStock: number;
}

async function parseRows(filePath: string): Promise<Row[]> {
  const workbook = new ExcelJS.Workbook();
  return workbook.xlsx.readFile(filePath).then((wb) => {
    const sheet = wb.worksheets[0];
    if (!sheet) throw new Error("File Excel tidak memiliki sheet apa pun.");
    const rows: Row[] = [];
    const skipped: Array<{ row: number; reason: string }> = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber < 3) return; // baris 1 header, baris 2 kosong
      const code = cleanText(row.getCell(1).text);
      const name = cleanText(row.getCell(2).text);
      if (!code && !name) return;
      if (!code || !name) {
        skipped.push({ row: rowNumber, reason: `kode/nama tidak lengkap (kode="${code}", nama="${name}")` });
        return;
      }
      const unitRaw = cleanText(row.getCell(6).text).toUpperCase();
      if (!unitRaw) {
        skipped.push({ row: rowNumber, reason: `${name}: satuan kosong` });
        return;
      }
      const unit = UNIT_FIX[unitRaw] ?? unitRaw;
      const minRaw = row.getCell(7).value;
      const minStock = Number(minRaw);
      if (!Number.isFinite(minStock) || minStock < 0) {
        throw new Error(
          `Baris ${rowNumber} (${name}): stok minimum tidak valid (${String(minRaw)}).`,
        );
      }
      rows.push({
        code,
        name: name.slice(0, 200),
        jenis: cleanText(row.getCell(3).text).toUpperCase(),
        unit,
        unitRaw,
        minStock,
      });
    });
    return { rows, skipped };
  });
}

async function main(): Promise<void> {
  const filePath =
    process.argv[2] ?? path.join(config.projectRoot, "bahan upload", "DATA BARANG.xlsx");
  const { rows, skipped } = await parseRows(filePath);
  if (!rows.length) throw new Error("Tidak ada baris barang terbaca dari file.");

  const db = getDb();
  const now = nowIso();

  const unitIds = new Map<string, number>();
  const categoryIds = new Map<string, number>();
  let unitsCreated = 0;
  let categoriesCreated = 0;
  let itemsCreated = 0;
  let itemsUpdated = 0;
  const unitFixes: Array<{ code: string; unit: string }> = [];

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) {
      if (row.unitRaw === row.unit) continue; // hanya catat yang dinormalisasi
      unitFixes.push({ code: row.code, unit: `${row.unitRaw} -> ${row.unit}` });
    }

    // Satuan
    for (const unitCode of [...new Set(rows.map((row) => row.unit))].sort()) {
      const existing = db
        .prepare("SELECT id FROM units WHERE UPPER(code) = UPPER(?)")
        .get(unitCode) as { id: number } | undefined;
      if (existing) {
        unitIds.set(unitCode, existing.id);
        continue;
      }
      const inserted = db
        .prepare("INSERT INTO units (code, name, created_at) VALUES (?, ?, ?)")
        .run(unitCode, titleCase(unitCode), now);
      unitIds.set(unitCode, Number(inserted.lastInsertRowid));
      unitsCreated += 1;
    }

    // Kategori dari kolom Jenis
    for (const name of [...new Set(rows.map((row) => row.jenis))].sort()) {
      if (!name) continue;
      const existing = db
        .prepare("SELECT id FROM item_categories WHERE name = ? COLLATE NOCASE")
        .get(name) as { id: number } | undefined;
      if (existing) {
        categoryIds.set(name, existing.id);
        continue;
      }
      const inserted = db
        .prepare("INSERT INTO item_categories (name, created_at) VALUES (?, ?)")
        .run(name, now);
      categoryIds.set(name, Number(inserted.lastInsertRowid));
      categoriesCreated += 1;
    }

    // Barang
    const selectItem = db.prepare(
      "SELECT id, base_unit_id, min_stock FROM items WHERE code = ? COLLATE NOCASE",
    );
    const insertItem = db.prepare(
      `INSERT INTO items (code, name, category_id, base_unit_id, min_stock, track_batch, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)`,
    );
    const updateItem = db.prepare(
      "UPDATE items SET name = ?, category_id = COALESCE(?, category_id), base_unit_id = ?, min_stock = ?, updated_at = ? WHERE id = ?",
    );
    for (const row of rows) {
      const categoryId = row.jenis ? (categoryIds.get(row.jenis) ?? null) : null;
      const unitId = unitIds.get(row.unit);
      if (!unitId) throw new Error(`Satuan "${row.unit}" tidak terdaftar.`);
      const existing = selectItem.get(row.code) as
        | { id: number; base_unit_id: number; min_stock: number }
        | undefined;
      if (existing) {
        updateItem.run(row.name, categoryId, unitId, row.minStock, now, existing.id);
        itemsUpdated += 1;
      } else {
        insertItem.run(
          row.code,
          row.name,
          categoryId,
          unitId,
          row.minStock,
          now,
          now,
        );
        itemsCreated += 1;
      }
    }

    writeAudit(db, {
      actor: null,
      action: "IMPORT_MASTER_BARANG",
      entityType: "items",
      entityId: null,
      after: {
        file: path.basename(filePath),
        rows: rows.length,
        itemsCreated,
        itemsUpdated,
        unitsCreated,
        categoriesCreated,
      },
      reason: "Impor massal master barang dari DATA BARANG.xlsx.",
    });

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  console.log(
    `Selesai: ${itemsCreated} barang baru, ${itemsUpdated} diperbarui, ` +
      `${unitsCreated} satuan baru, ${categoriesCreated} kategori baru (total baris ${rows.length}).`,
  );
  if (skipped.length) {
    console.log(`Baris dilewati (data sumber tidak lengkap): ${skipped.length}`);
    for (const item of skipped) console.log(`  baris ${item.row}: ${item.reason}`);
  }
  if (unitFixes.length) {
    console.log("Satuan yang dinormalisasi:");
    for (const fix of unitFixes) console.log(`  ${fix.code}: ${fix.unit}`);
  }
}

main().catch((error) => {
  console.error("Impor gagal:", (error as Error).message);
  process.exit(1);
});
