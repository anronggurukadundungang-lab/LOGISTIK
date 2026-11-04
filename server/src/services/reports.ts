import { getDb } from "../db.ts";
import { parseDateToIso, roundQty, todayLocal } from "../lib/utils.ts";
import type { AuthUser } from "../lib/auth.ts";

export interface ReportFilters {
  from?: string;
  to?: string;
  departmentId?: number;
  categoryId?: number;
  itemId?: number;
  status?: string;
  group?: "detail" | "day" | "month";
  days?: number;
}

export interface ReportColumn {
  key: string;
  header: string;
  width?: number;
  type?: "text" | "number" | "qty" | "date" | "datetime";
}

export interface ReportData {
  type: string;
  title: string;
  subtitle: string;
  columns: ReportColumn[];
  rows: Array<Record<string, unknown>>;
  summary: Array<{ label: string; value: string | number }>;
  filterLabels: Array<{ label: string; value: string }>;
  generatedAt: string;
  generatedBy: string;
  truncated: boolean;
}

const MAX_ROWS = 5000;

function period(filters: ReportFilters): { from: string; to: string } {
  const today = todayLocal();
  return {
    from: parseDateToIso(filters.from) ?? `${today.slice(0, 7)}-01`,
    to: parseDateToIso(filters.to) ?? today,
  };
}

function scope(user: AuthUser, alias: string, filters: ReportFilters) {
  const conditions: string[] = [];
  const params: Array<number> = [];
  if (!user.allDepartments) {
    if (!user.departmentIds.length) return { sql: " AND 1 = 0", params: [] };
    conditions.push(
      `${alias}.department_id IN (${user.departmentIds.map(() => "?").join(",")})`,
    );
    params.push(...user.departmentIds);
  }
  if (filters.departmentId) {
    conditions.push(`${alias}.department_id = ?`);
    params.push(filters.departmentId);
  }
  return {
    sql: conditions.length ? ` AND ${conditions.join(" AND ")}` : "",
    params,
  };
}

function itemFilter(filters: ReportFilters, alias: string) {
  const conditions: string[] = [];
  const params: Array<number> = [];
  if (filters.categoryId) {
    conditions.push(`${alias}.category_id = ?`);
    params.push(filters.categoryId);
  }
  if (filters.itemId) {
    conditions.push(`${alias}.id = ?`);
    params.push(filters.itemId);
  }
  return {
    sql: conditions.length ? ` AND ${conditions.join(" AND ")}` : "",
    params,
  };
}

function filterLabels(
  user: AuthUser,
  filters: ReportFilters,
  range?: { from: string; to: string },
): Array<{ label: string; value: string }> {
  const db = getDb();
  const labels: Array<{ label: string; value: string }> = [];
  labels.push({
    label: "Periode",
    value: range ? `${range.from} s.d. ${range.to}` : "Seluruh data",
  });
  if (filters.departmentId) {
    const dept = db
      .prepare("SELECT name FROM departments WHERE id = ?")
      .get(filters.departmentId) as { name: string } | undefined;
    labels.push({ label: "Bagian", value: dept?.name ?? "-" });
  } else {
    labels.push({
      label: "Cakupan bagian",
      value: user.allDepartments
        ? "Seluruh bagian"
        : `${user.departmentIds.length} bagian ditugaskan`,
    });
  }
  if (filters.categoryId) {
    const cat = db
      .prepare("SELECT name FROM item_categories WHERE id = ?")
      .get(filters.categoryId) as { name: string } | undefined;
    labels.push({ label: "Kategori", value: cat?.name ?? "-" });
  }
  if (filters.itemId) {
    const item = db
      .prepare("SELECT name FROM items WHERE id = ?")
      .get(filters.itemId) as { name: string } | undefined;
    labels.push({ label: "Barang", value: item?.name ?? "-" });
  }
  return labels;
}

function limitRows(rows: Array<Record<string, unknown>>): {
  rows: Array<Record<string, unknown>>;
  truncated: boolean;
} {
  return { rows: rows.slice(0, MAX_ROWS), truncated: rows.length > MAX_ROWS };
}

function sum(rows: Array<Record<string, unknown>>, key: string): number {
  return roundQty(
    rows.reduce((total, row) => total + Number(row[key] ?? 0), 0),
  );
}

export function buildReport(
  user: AuthUser,
  type: string,
  filters: ReportFilters,
): ReportData {
  const db = getDb();
  const range = period(filters);
  const generatedAt = new Date().toISOString();
  const generatedBy = user.name;
  const base = {
    type,
    generatedAt,
    generatedBy,
    filterLabels: filterLabels(user, filters, range),
  };

  switch (type) {
    case "issues": {
      const sc = scope(user, "t", filters);
      const rows = db
        .prepare(
          `SELECT t.source_date, t.source_doc_number, t.source_line_number, d.name AS department_name,
                  i.code AS item_code, i.name AS item_name, u.code AS unit_code,
                  t.qty_requested, t.qty_approved, t.qty_issued, t.qty_received, t.status,
                  b.filename AS import_file, t.source_identity
             FROM simdondar_transactions t
             JOIN departments d ON d.id = t.department_id
             JOIN items i ON i.id = t.item_id
             JOIN units u ON u.id = t.unit_id
             LEFT JOIN simdondar_import_batches b ON b.id = t.import_batch_id
            WHERE t.source_date BETWEEN ? AND ? ${sc.sql}
            ORDER BY t.source_date DESC, t.id DESC`,
        )
        .all(range.from, range.to, ...sc.params) as Array<
        Record<string, unknown>
      >;
      const limited = limitRows(rows);
      return {
        ...base,
        title: "Laporan Pengeluaran Logistik (SIMDONDAR)",
        subtitle: "Data transaksi barang keluar yang diimpor dari SIMDONDAR",
        columns: [
          { key: "source_date", header: "Tanggal", type: "date", width: 12 },
          { key: "source_doc_number", header: "No. Dokumen", width: 18 },
          { key: "department_name", header: "Bagian Penerima", width: 26 },
          { key: "item_code", header: "Kode", width: 12 },
          { key: "item_name", header: "Nama Barang", width: 30 },
          { key: "unit_code", header: "Satuan", width: 8 },
          { key: "qty_requested", header: "Diminta", type: "qty", width: 10 },
          { key: "qty_approved", header: "Disetujui", type: "qty", width: 10 },
          { key: "qty_issued", header: "Keluar", type: "qty", width: 10 },
          { key: "qty_received", header: "Diterima", type: "qty", width: 10 },
          { key: "status", header: "Status", width: 22 },
          { key: "source_identity", header: "Identitas Sumber", width: 30 },
        ],
        rows: limited.rows,
        summary: [
          { label: "Jumlah transaksi", value: rows.length },
          { label: "Total qty keluar", value: sum(rows, "qty_issued") },
          { label: "Total qty diterima", value: sum(rows, "qty_received") },
        ],
        truncated: limited.truncated,
      };
    }

    case "receipts": {
      const sc = scope(user, "e", filters);
      const item = itemFilter(filters, "i");
      const rows = db
        .prepare(
          `SELECT e.occurred_at, e.entry_no, d.name AS department_name, i.code AS item_code, i.name AS item_name,
                  u.code AS unit_code, e.qty_delta AS qty_received, t.qty_issued, t.source_doc_number,
                  ROUND(e.qty_delta - t.qty_issued, 6) AS difference, t.status,
                  us.name AS received_by_name, e.source_ref
             FROM stock_entries e
             JOIN items i ON i.id = e.item_id
             JOIN units u ON u.id = e.unit_id
             JOIN departments d ON d.id = e.department_id
             JOIN users us ON us.id = e.created_by
             JOIN simdondar_transactions t ON t.receipt_entry_id = e.id
            WHERE e.entry_type = 'RECEIPT' AND e.occurred_at BETWEEN ? AND ? ${sc.sql}${item.sql}
            ORDER BY e.occurred_at DESC, e.id DESC`,
        )
        .all(range.from, range.to, ...sc.params, ...item.params) as Array<
        Record<string, unknown>
      >;
      const limited = limitRows(rows);
      return {
        ...base,
        title: "Laporan Penerimaan Barang per Bagian",
        subtitle: "Barang yang telah diterima/diakui masuk ke stok bagian",
        columns: [
          { key: "occurred_at", header: "Tanggal", type: "date", width: 12 },
          { key: "entry_no", header: "No. Transaksi", width: 18 },
          { key: "department_name", header: "Bagian", width: 26 },
          { key: "item_code", header: "Kode", width: 12 },
          { key: "item_name", header: "Nama Barang", width: 30 },
          { key: "unit_code", header: "Satuan", width: 8 },
          {
            key: "qty_issued",
            header: "Keluar SIMDONDAR",
            type: "qty",
            width: 14,
          },
          { key: "qty_received", header: "Diterima", type: "qty", width: 10 },
          { key: "difference", header: "Selisih", type: "qty", width: 10 },
          { key: "source_doc_number", header: "No. Dokumen", width: 18 },
          { key: "status", header: "Status", width: 22 },
        ],
        rows: limited.rows,
        summary: [
          { label: "Jumlah penerimaan", value: rows.length },
          { label: "Total diterima", value: sum(rows, "qty_received") },
          { label: "Total selisih", value: sum(rows, "difference") },
        ],
        truncated: limited.truncated,
      };
    }

    case "consumptions": {
      const sc = scope(user, "e", filters);
      const item = itemFilter(filters, "i");
      const group = filters.group ?? "detail";
      if (group === "day" || group === "month") {
        const fmt = group === "day" ? 10 : 7;
        const rows = db
          .prepare(
            `SELECT substr(e.occurred_at, 1, ${fmt}) AS period, COUNT(*) AS trx_count,
                    ROUND(SUM(-e.qty_delta), 6) AS qty
               FROM stock_entries e JOIN items i ON i.id = e.item_id
              WHERE e.entry_type = 'CONSUMPTION' AND e.occurred_at BETWEEN ? AND ? ${sc.sql}${item.sql}
              GROUP BY period ORDER BY period`,
          )
          .all(range.from, range.to, ...sc.params, ...item.params) as Array<
          Record<string, unknown>
        >;
        return {
          ...base,
          title:
            group === "day"
              ? "Laporan Pemakaian Harian"
              : "Laporan Pemakaian Bulanan",
          subtitle: "Rekap pemakaian barang per bagian",
          columns: [
            {
              key: "period",
              header: group === "day" ? "Tanggal" : "Bulan",
              width: 16,
            },
            {
              key: "trx_count",
              header: "Jumlah transaksi",
              type: "number",
              width: 18,
            },
            { key: "qty", header: "Total qty dipakai", type: "qty", width: 18 },
          ],
          rows,
          summary: [
            { label: "Jumlah transaksi", value: sum(rows, "trx_count") },
            { label: "Total qty dipakai", value: sum(rows, "qty") },
          ],
          truncated: false,
        };
      }
      const rows = db
        .prepare(
          `SELECT e.occurred_at, e.entry_no, d.name AS department_name, i.code AS item_code, i.name AS item_name,
                  u.code AS unit_code, -e.qty_delta AS qty, c.activity_category, c.officer_name,
                  c.notes, us.name AS input_by, e.created_at
             FROM stock_entries e
             JOIN stock_consumptions c ON c.entry_id = e.id
             JOIN items i ON i.id = e.item_id
             JOIN units u ON u.id = e.unit_id
             JOIN departments d ON d.id = e.department_id
             JOIN users us ON us.id = e.created_by
            WHERE e.occurred_at BETWEEN ? AND ? ${sc.sql}${item.sql}
            ORDER BY e.occurred_at DESC, e.id DESC`,
        )
        .all(range.from, range.to, ...sc.params, ...item.params) as Array<
        Record<string, unknown>
      >;
      const limited = limitRows(rows);
      return {
        ...base,
        title: "Laporan Pemakaian Barang",
        subtitle: "Rincian pemakaian yang diinput oleh PIC/staf bagian",
        columns: [
          { key: "occurred_at", header: "Tanggal", type: "date", width: 12 },
          { key: "entry_no", header: "No. Transaksi", width: 18 },
          { key: "department_name", header: "Bagian", width: 24 },
          { key: "item_code", header: "Kode", width: 12 },
          { key: "item_name", header: "Nama Barang", width: 28 },
          { key: "unit_code", header: "Satuan", width: 8 },
          { key: "qty", header: "Pemakaian", type: "qty", width: 10 },
          { key: "activity_category", header: "Kegiatan", width: 18 },
          { key: "officer_name", header: "Petugas", width: 20 },
          { key: "notes", header: "Keterangan", width: 30 },
        ],
        rows: limited.rows,
        summary: [
          { label: "Jumlah transaksi", value: rows.length },
          { label: "Total pemakaian", value: sum(rows, "qty") },
        ],
        truncated: limited.truncated,
      };
    }

    case "stock-summary": {
      const sc = scope(user, "b", filters);
      const item = itemFilter(filters, "i");
      const rows = db
        .prepare(
          `SELECT d.name AS department_name, i.code AS item_code, i.name AS item_name, u.code AS unit_code,
                  b.qty AS system_qty, i.min_stock,
                  (SELECT COALESCE(SUM(CASE WHEN e.entry_type = 'RECEIPT' THEN e.qty_delta ELSE 0 END), 0)
                     FROM stock_entries e WHERE e.department_id = b.department_id AND e.item_id = b.item_id) AS received_total,
                  (SELECT COALESCE(-SUM(CASE WHEN e.entry_type = 'CONSUMPTION' THEN e.qty_delta ELSE 0 END), 0)
                     FROM stock_entries e WHERE e.department_id = b.department_id AND e.item_id = b.item_id) AS consumption_total,
                  (SELECT od.physical_qty FROM stock_opname_details od
                     JOIN stock_opname_sessions os ON os.id = od.session_id
                    WHERE os.department_id = b.department_id AND od.item_id = b.item_id
                      AND os.status IN ('SUBMITTED','APPROVED')
                    ORDER BY os.opname_date DESC, os.id DESC LIMIT 1) AS physical_qty,
                  (SELECT od.difference FROM stock_opname_details od
                     JOIN stock_opname_sessions os ON os.id = od.session_id
                    WHERE os.department_id = b.department_id AND od.item_id = b.item_id
                      AND os.status IN ('SUBMITTED','APPROVED')
                    ORDER BY os.opname_date DESC, os.id DESC LIMIT 1) AS difference,
                  b.updated_at
             FROM department_stock_balances b
             JOIN items i ON i.id = b.item_id
             JOIN units u ON u.id = i.base_unit_id
             JOIN departments d ON d.id = b.department_id
            WHERE b.qty <> 0 ${sc.sql}${item.sql}
            ORDER BY d.name, i.name`,
        )
        .all(...sc.params, ...item.params) as Array<Record<string, unknown>>;
      const limited = limitRows(rows);
      return {
        ...base,
        title: "Laporan Stok per Bagian",
        subtitle: "Saldo sistem, hasil stok fisik terakhir, dan selisih",
        columns: [
          { key: "department_name", header: "Bagian", width: 28 },
          { key: "item_code", header: "Kode", width: 12 },
          { key: "item_name", header: "Nama Barang", width: 30 },
          { key: "unit_code", header: "Satuan", width: 8 },
          { key: "received_total", header: "Diterima", type: "qty", width: 10 },
          {
            key: "consumption_total",
            header: "Pemakaian",
            type: "qty",
            width: 10,
          },
          { key: "system_qty", header: "Sisa Sistem", type: "qty", width: 12 },
          { key: "min_stock", header: "Minimum", type: "qty", width: 10 },
          { key: "physical_qty", header: "Stok Fisik", type: "qty", width: 10 },
          { key: "difference", header: "Selisih", type: "qty", width: 10 },
        ],
        rows: limited.rows,
        summary: [
          { label: "Baris stok", value: rows.length },
          { label: "Total sisa stok", value: sum(rows, "system_qty") },
        ],
        truncated: limited.truncated,
      };
    }

    case "stock-card": {
      const sc = scope(user, "e", filters);
      const item = itemFilter(filters, "i");
      const rows = db
        .prepare(
          `SELECT e.occurred_at, e.entry_no, e.entry_type, e.description, e.qty_delta, e.balance_after,
                  d.name AS department_name, i.code AS item_code, i.name AS item_name, u.code AS unit_code,
                  us.name AS input_by, e.source_ref, e.reason
             FROM stock_entries e
             JOIN items i ON i.id = e.item_id
             JOIN units u ON u.id = e.unit_id
             JOIN departments d ON d.id = e.department_id
             JOIN users us ON us.id = e.created_by
            WHERE e.occurred_at BETWEEN ? AND ? ${sc.sql}${item.sql}
            ORDER BY d.name, i.name, e.occurred_at, e.id`,
        )
        .all(range.from, range.to, ...sc.params, ...item.params) as Array<
        Record<string, unknown>
      >;
      const mapped = rows.map((row) => {
        const delta = Number(row.qty_delta);
        const t = String(row.entry_type);
        return {
          ...row,
          masuk:
            ["RECEIPT", "OPENING"].includes(t) ||
            (t === "REVERSAL" && delta > 0)
              ? delta
              : 0,
          pemakaian: t === "CONSUMPTION" ? Math.abs(delta) : 0,
          retur: t === "RETURN" ? Math.abs(delta) : 0,
          rusak_hilang: ["DAMAGE", "LOSS", "EXPIRED"].includes(t)
            ? Math.abs(delta)
            : 0,
          penyesuaian: ["ADJUSTMENT", "REVERSAL"].includes(t) ? delta : 0,
        };
      });
      const limited = limitRows(mapped);
      return {
        ...base,
        title: "Laporan Kartu Stok",
        subtitle: "Seluruh pergerakan barang beserta saldo berjalan",
        columns: [
          { key: "occurred_at", header: "Tanggal", type: "date", width: 11 },
          { key: "entry_no", header: "No. Transaksi", width: 17 },
          { key: "department_name", header: "Bagian", width: 22 },
          { key: "item_name", header: "Barang", width: 26 },
          { key: "entry_type", header: "Jenis", width: 14 },
          { key: "description", header: "Keterangan", width: 28 },
          { key: "masuk", header: "Masuk", type: "qty", width: 9 },
          { key: "pemakaian", header: "Pemakaian", type: "qty", width: 10 },
          { key: "retur", header: "Retur", type: "qty", width: 8 },
          {
            key: "rusak_hilang",
            header: "Rusak/Hilang",
            type: "qty",
            width: 11,
          },
          { key: "penyesuaian", header: "Penyesuaian", type: "qty", width: 11 },
          { key: "balance_after", header: "Saldo", type: "qty", width: 10 },
          { key: "input_by", header: "Penginput", width: 18 },
        ],
        rows: limited.rows,
        summary: [
          { label: "Jumlah baris", value: mapped.length },
          { label: "Total masuk", value: sum(mapped, "masuk") },
          { label: "Total pemakaian", value: sum(mapped, "pemakaian") },
        ],
        truncated: limited.truncated,
      };
    }

    case "opnames": {
      const sc = scope(user, "s", filters);
      const rows = db
        .prepare(
          `SELECT s.opname_date, s.period, d.name AS department_name, s.status, s.notes,
                  (SELECT COUNT(*) FROM stock_opname_details od WHERE od.session_id = s.id) AS item_count,
                  (SELECT COUNT(*) FROM stock_opname_details od WHERE od.session_id = s.id
                    AND ABS(COALESCE(od.difference, 0)) > 0.0001) AS diff_count,
                  (SELECT COALESCE(SUM(ABS(od.difference)), 0) FROM stock_opname_details od
                    WHERE od.session_id = s.id AND ABS(COALESCE(od.difference, 0)) > 0.0001) AS diff_qty,
                  us.name AS created_by_name, du.name AS decided_by_name, s.decided_at
             FROM stock_opname_sessions s
             JOIN departments d ON d.id = s.department_id
             JOIN users us ON us.id = s.created_by
             LEFT JOIN users du ON du.id = s.decided_by
            WHERE s.opname_date BETWEEN ? AND ? ${sc.sql}
            ORDER BY s.opname_date DESC, s.id DESC`,
        )
        .all(range.from, range.to, ...sc.params) as Array<
        Record<string, unknown>
      >;
      return {
        ...base,
        title: "Laporan Stok Opname",
        subtitle: "Sesi opname, jumlah item, dan status persetujuan",
        columns: [
          { key: "opname_date", header: "Tanggal", type: "date", width: 12 },
          { key: "period", header: "Periode", width: 10 },
          { key: "department_name", header: "Bagian", width: 28 },
          { key: "item_count", header: "Item", type: "number", width: 8 },
          {
            key: "diff_count",
            header: "Item Selisih",
            type: "number",
            width: 12,
          },
          { key: "diff_qty", header: "Qty Selisih", type: "qty", width: 12 },
          { key: "status", header: "Status", width: 16 },
          { key: "created_by_name", header: "Dibuat oleh", width: 20 },
          { key: "decided_by_name", header: "Diputuskan oleh", width: 20 },
        ],
        rows,
        summary: [
          { label: "Jumlah sesi", value: rows.length },
          { label: "Total item selisih", value: sum(rows, "diff_count") },
          { label: "Total qty selisih", value: sum(rows, "diff_qty") },
        ],
        truncated: false,
      };
    }

    case "discrepancies": {
      const sc = scope(user, "s", filters);
      const rows = db
        .prepare(
          `SELECT s.opname_date, d.name AS department_name, i.code AS item_code, i.name AS item_name,
                  u.code AS unit_code, od.system_qty, od.physical_qty, od.difference, od.reason, s.status,
                  e.entry_no AS adjustment_entry_no
             FROM stock_opname_details od
             JOIN stock_opname_sessions s ON s.id = od.session_id
             JOIN departments d ON d.id = s.department_id
             JOIN items i ON i.id = od.item_id
             JOIN units u ON u.id = i.base_unit_id
             LEFT JOIN stock_entries e ON e.id = od.adjustment_entry_id
            WHERE ABS(COALESCE(od.difference, 0)) > 0.0001
              AND s.opname_date BETWEEN ? AND ? ${sc.sql}
            ORDER BY s.opname_date DESC, ABS(od.difference) DESC`,
        )
        .all(range.from, range.to, ...sc.params) as Array<
        Record<string, unknown>
      >;
      return {
        ...base,
        title: "Laporan Selisih Stok",
        subtitle: "Selisih antara stok sistem dan hasil hitung fisik",
        columns: [
          { key: "opname_date", header: "Tanggal", type: "date", width: 12 },
          { key: "department_name", header: "Bagian", width: 26 },
          { key: "item_code", header: "Kode", width: 12 },
          { key: "item_name", header: "Barang", width: 28 },
          { key: "unit_code", header: "Satuan", width: 8 },
          { key: "system_qty", header: "Stok Sistem", type: "qty", width: 12 },
          { key: "physical_qty", header: "Stok Fisik", type: "qty", width: 12 },
          { key: "difference", header: "Selisih", type: "qty", width: 10 },
          { key: "status", header: "Status", width: 16 },
          { key: "reason", header: "Alasan", width: 30 },
        ],
        rows,
        summary: [
          { label: "Jumlah baris selisih", value: rows.length },
          {
            label: "Total selisih absolut",
            value: roundQty(
              rows.reduce((t, r) => t + Math.abs(Number(r.difference)), 0),
            ),
          },
        ],
        truncated: false,
      };
    }

    case "damages":
    case "losses": {
      const kind = type === "damages" ? ["DAMAGE", "EXPIRED"] : ["LOSS"];
      const sc = scope(user, "e", filters);
      const item = itemFilter(filters, "i");
      const rows = db
        .prepare(
          `SELECT e.occurred_at, e.entry_no, d.name AS department_name, i.code AS item_code, i.name AS item_name,
                  u.code AS unit_code, dmg.kind, -e.qty_delta AS qty, dmg.notes, e.reason,
                  us.name AS input_by
             FROM stock_entries e
             JOIN stock_damages dmg ON dmg.entry_id = e.id
             JOIN items i ON i.id = e.item_id
             JOIN units u ON u.id = e.unit_id
             JOIN departments d ON d.id = e.department_id
             JOIN users us ON us.id = e.created_by
            WHERE dmg.kind IN (${kind.map(() => "?").join(",")}) AND e.occurred_at BETWEEN ? AND ? ${sc.sql}${item.sql}
            ORDER BY e.occurred_at DESC, e.id DESC`,
        )
        .all(
          ...kind,
          range.from,
          range.to,
          ...sc.params,
          ...item.params,
        ) as Array<Record<string, unknown>>;
      const limited = limitRows(rows);
      return {
        ...base,
        title:
          type === "damages"
            ? "Laporan Barang Rusak / Kedaluwarsa"
            : "Laporan Barang Hilang",
        subtitle: "Transaksi pengurangan stok yang telah disetujui",
        columns: [
          { key: "occurred_at", header: "Tanggal", type: "date", width: 12 },
          { key: "entry_no", header: "No. Transaksi", width: 18 },
          { key: "department_name", header: "Bagian", width: 26 },
          { key: "item_code", header: "Kode", width: 12 },
          { key: "item_name", header: "Barang", width: 28 },
          { key: "unit_code", header: "Satuan", width: 8 },
          { key: "kind", header: "Jenis", width: 12 },
          { key: "qty", header: "Jumlah", type: "qty", width: 10 },
          { key: "notes", header: "Keterangan", width: 34 },
          { key: "input_by", header: "Penginput", width: 18 },
        ],
        rows: limited.rows,
        summary: [
          { label: "Jumlah transaksi", value: rows.length },
          { label: "Total qty", value: sum(rows, "qty") },
        ],
        truncated: limited.truncated,
      };
    }

    case "returns": {
      const sc = scope(user, "e", filters);
      const rows = db
        .prepare(
          `SELECT e.occurred_at, e.entry_no, d.name AS department_name, i.code AS item_code, i.name AS item_name,
                  u.code AS unit_code, -e.qty_delta AS qty, r.destination, r.notes, us.name AS input_by
             FROM stock_entries e
             JOIN stock_returns r ON r.entry_id = e.id
             JOIN items i ON i.id = e.item_id
             JOIN units u ON u.id = e.unit_id
             JOIN departments d ON d.id = e.department_id
             JOIN users us ON us.id = e.created_by
            WHERE e.occurred_at BETWEEN ? AND ? ${sc.sql}
            ORDER BY e.occurred_at DESC, e.id DESC`,
        )
        .all(range.from, range.to, ...sc.params) as Array<
        Record<string, unknown>
      >;
      return {
        ...base,
        title: "Laporan Retur Barang ke Logistik",
        subtitle: "Barang yang dikembalikan dari bagian",
        columns: [
          { key: "occurred_at", header: "Tanggal", type: "date", width: 12 },
          { key: "entry_no", header: "No. Transaksi", width: 18 },
          { key: "department_name", header: "Bagian", width: 26 },
          { key: "item_name", header: "Barang", width: 28 },
          { key: "unit_code", header: "Satuan", width: 8 },
          { key: "qty", header: "Qty Retur", type: "qty", width: 10 },
          { key: "destination", header: "Tujuan", width: 16 },
          { key: "notes", header: "Keterangan", width: 34 },
        ],
        rows,
        summary: [
          { label: "Total qty retur", value: sum(rows, "qty") },
          { label: "Jumlah transaksi", value: rows.length },
        ],
        truncated: false,
      };
    }

    case "late-input": {
      const lateDays =
        filters.days ??
        Number(
          (
            db
              .prepare(
                "SELECT value FROM settings WHERE key = 'late_input_days'",
              )
              .get() as { value?: string } | undefined
          )?.value ?? 3,
        );
      const deptConditions: string[] = [];
      const deptParams: number[] = [];
      if (!user.allDepartments) {
        if (!user.departmentIds.length) {
          deptConditions.push("1 = 0");
        } else {
          deptConditions.push(
            `d.id IN (${user.departmentIds.map(() => "?").join(",")})`,
          );
          deptParams.push(...user.departmentIds);
        }
      }
      if (filters.departmentId) {
        deptConditions.push("d.id = ?");
        deptParams.push(filters.departmentId);
      }
      const deptSql = deptConditions.length
        ? ` AND ${deptConditions.join(" AND ")}`
        : "";
      const rows = db
        .prepare(
          `SELECT d.name AS department_name,
                  (SELECT MAX(e.occurred_at) FROM stock_entries e
                    WHERE e.department_id = d.id AND e.entry_type = 'CONSUMPTION') AS last_input,
                  (SELECT COUNT(*) FROM simdondar_transactions t
                    WHERE t.department_id = d.id AND t.status <> 'CANCELLED' AND t.source_date BETWEEN ? AND ?) AS receipt_count,
                  CAST(julianday(?) - julianday((SELECT MAX(e.occurred_at) FROM stock_entries e
                    WHERE e.department_id = d.id AND e.entry_type = 'CONSUMPTION')) AS INTEGER) AS days_since_input
             FROM departments d
            WHERE d.is_active = 1 ${deptSql}
            ORDER BY last_input ASC`,
        )
        .all(range.from, range.to, range.to, ...deptParams) as Array<
        Record<string, unknown>
      >;
      const filtered = rows.filter(
        (row) =>
          row.last_input === null || Number(row.days_since_input) >= lateDays,
      );
      return {
        ...base,
        title: "Laporan Keterlambatan Input Pemakaian",
        subtitle: `Bagian yang belum/tidak mencatat pemakaian dalam ${lateDays} hari terakhir`,
        columns: [
          { key: "department_name", header: "Bagian", width: 30 },
          {
            key: "last_input",
            header: "Input Terakhir",
            type: "date",
            width: 14,
          },
          {
            key: "days_since_input",
            header: "Hari Sejak Input",
            type: "number",
            width: 14,
          },
          {
            key: "receipt_count",
            header: "Penerimaan Periode",
            type: "number",
            width: 16,
          },
        ],
        rows: filtered,
        summary: [
          { label: "Bagian terlambat", value: filtered.length },
          { label: "Ambang hari", value: lateDays },
        ],
        truncated: false,
      };
    }

    case "procurement": {
      const days = filters.days ?? 90;
      const sc = scope(user, "b", filters);
      const item = itemFilter(filters, "i");
      const rows = db
        .prepare(
          `SELECT d.name AS department_name, i.code AS item_code, i.name AS item_name, u.code AS unit_code,
                  b.qty AS current_qty, i.min_stock,
                  ROUND((SELECT COALESCE(SUM(-e.qty_delta), 0) FROM stock_entries e
                    WHERE e.department_id = b.department_id AND e.item_id = b.item_id
                      AND e.entry_type = 'CONSUMPTION'
                      AND e.occurred_at >= date(?, ?)), 6) AS consumption_period,
                  ROUND((SELECT COALESCE(SUM(-e.qty_delta), 0) FROM stock_entries e
                    WHERE e.department_id = b.department_id AND e.item_id = b.item_id
                      AND e.entry_type = 'CONSUMPTION'
                      AND e.occurred_at >= date(?, ?)) / ?, 6) AS avg_per_month
             FROM department_stock_balances b
             JOIN items i ON i.id = b.item_id
             JOIN units u ON u.id = i.base_unit_id
             JOIN departments d ON d.id = b.department_id
            WHERE i.is_active = 1 ${sc.sql}${item.sql}
            ORDER BY d.name, i.name`,
        )
        .all(
          range.to,
          `-${days} days`,
          range.to,
          `-${days} days`,
          days / 30,
          ...sc.params,
          ...item.params,
        ) as Array<Record<string, unknown>>;
      const withRecommendation = rows.map((row) => {
        const recommended = Math.max(
          0,
          Math.ceil(
            Number(row.min_stock) +
              Number(row.avg_per_month) * 1.5 -
              Number(row.current_qty),
          ),
        );
        return {
          ...row,
          recommended_qty: recommended,
          status: recommended > 0 ? "PERLU PENGADAAN" : "CUKUP",
        };
      });
      const limited = limitRows(withRecommendation);
      return {
        ...base,
        title: "Rekap Kebutuhan dan Pemakaian untuk Pengadaan",
        subtitle: `Estimasi kebutuhan berdasarkan saldo, stok minimum, dan rata-rata pemakaian ${days} hari`,
        columns: [
          { key: "department_name", header: "Bagian", width: 26 },
          { key: "item_code", header: "Kode", width: 12 },
          { key: "item_name", header: "Barang", width: 28 },
          { key: "unit_code", header: "Satuan", width: 8 },
          { key: "current_qty", header: "Saldo", type: "qty", width: 10 },
          { key: "min_stock", header: "Minimum", type: "qty", width: 10 },
          {
            key: "consumption_period",
            header: `Pemakaian ${days} hr`,
            type: "qty",
            width: 13,
          },
          {
            key: "avg_per_month",
            header: "Rata-rata/Bulan",
            type: "qty",
            width: 14,
          },
          {
            key: "recommended_qty",
            header: "Rekomendasi",
            type: "qty",
            width: 12,
          },
          { key: "status", header: "Status", width: 16 },
        ],
        rows: limited.rows,
        summary: [
          { label: "Baris barang", value: withRecommendation.length },
          {
            label: "Item perlu pengadaan",
            value: withRecommendation.filter(
              (row) => Number(row.recommended_qty) > 0,
            ).length,
          },
          {
            label: "Total rekomendasi qty",
            value: sum(withRecommendation, "recommended_qty"),
          },
        ],
        truncated: limited.truncated,
      };
    }

    default:
      throw Object.assign(new Error("Jenis laporan tidak dikenal."), {
        status: 404,
      });
  }
}

export const REPORT_TYPES = [
  { type: "issues", label: "Pengeluaran Logistik (SIMDONDAR)" },
  { type: "receipts", label: "Penerimaan per Bagian" },
  { type: "consumptions", label: "Pemakaian" },
  { type: "stock-summary", label: "Stok per Bagian" },
  { type: "stock-card", label: "Kartu Stok" },
  { type: "opnames", label: "Stok Opname" },
  { type: "discrepancies", label: "Selisih Stok" },
  { type: "damages", label: "Barang Rusak / Kedaluwarsa" },
  { type: "losses", label: "Barang Hilang" },
  { type: "returns", label: "Retur ke Logistik" },
  { type: "late-input", label: "Keterlambatan Input Pemakaian" },
  { type: "procurement", label: "Rekap Kebutuhan Pengadaan" },
];
