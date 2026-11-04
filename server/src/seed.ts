import { config } from "./config.ts";
import { getDb, nowIso, withTx } from "./db.ts";
import { hashPassword } from "./lib/password.ts";

export const PERMISSIONS: Array<[string, string]> = [
  ["dashboard.view", "Melihat dashboard sesuai cakupan"],
  ["dashboard.view_all", "Melihat dashboard seluruh bagian"],
  ["items.view", "Melihat master barang"],
  ["items.manage", "Mengelola master barang, kategori, satuan, konversi"],
  ["departments.view", "Melihat master bagian"],
  ["departments.manage", "Mengelola master bagian"],
  ["imports.view", "Melihat riwayat impor SIMDONDAR"],
  ["imports.manage", "Mengunggah, memetakan, dan commit impor"],
  ["stocks.view", "Melihat stok dan kartu stok sesuai cakupan"],
  ["stocks.view_all", "Melihat stok seluruh bagian"],
  ["receipts.confirm", "Mengonfirmasi penerimaan barang"],
  ["consumptions.create", "Mencatat pemakaian barang"],
  ["returns.create", "Mencatat retur ke Logistik"],
  ["damages.create", "Mengajukan pencatatan rusak/hilang/kedaluwarsa"],
  ["adjustments.request", "Mengajukan penyesuaian stok"],
  ["opnames.create", "Membuat dan mengisi stok opname"],
  ["opnames.view_all", "Melihat stok opname seluruh bagian"],
  ["approvals.view", "Melihat antrean persetujuan"],
  ["approvals.decide", "Menyetujui/menolak pengajuan"],
  ["reports.view", "Melihat laporan"],
  ["reports.export", "Mengekspor laporan Excel/PDF"],
  ["users.manage", "Mengelola akun pengguna"],
  ["audit.view", "Melihat audit trail"],
  ["settings.manage", "Mengelola pengaturan sistem"],
  ["notifications.view", "Melihat notifikasi"],
];

const ALL = PERMISSIONS.map(([code]) => code);

export const ROLES: Array<{
  code: string;
  name: string;
  description: string;
  permissions: string[];
}> = [
  {
    code: "SUPER_ADMIN",
    name: "Administrator Sistem",
    description: "Mengatur pengguna, role, master, pengaturan, dan audit.",
    permissions: ALL,
  },
  {
    code: "WAKIL_KEPALA",
    name: "Wakil Kepala",
    description: "Monitoring dan laporan lintas bagian, baca saja.",
    permissions: [
      "dashboard.view",
      "dashboard.view_all",
      "items.view",
      "departments.view",
      "imports.view",
      "stocks.view",
      "stocks.view_all",
      "opnames.view_all",
      "approvals.view",
      "reports.view",
      "reports.export",
      "audit.view",
      "notifications.view",
    ],
  },
  {
    code: "KABID_LOGISTIK",
    name: "Kabid Logistik",
    description:
      "Mengelola pemetaan, impor, monitoring, dan otorisasi koreksi.",
    permissions: [
      "dashboard.view",
      "dashboard.view_all",
      "items.view",
      "items.manage",
      "departments.view",
      "departments.manage",
      "imports.view",
      "imports.manage",
      "stocks.view",
      "stocks.view_all",
      "receipts.confirm",
      "adjustments.request",
      "opnames.view_all",
      "approvals.view",
      "approvals.decide",
      "reports.view",
      "reports.export",
      "notifications.view",
    ],
  },
  {
    code: "STAF_LOGISTIK",
    name: "Staf Logistik",
    description: "Menjalankan impor, pemeriksaan hasil, dan laporan.",
    permissions: [
      "dashboard.view",
      "dashboard.view_all",
      "items.view",
      "departments.view",
      "imports.view",
      "imports.manage",
      "stocks.view",
      "stocks.view_all",
      "receipts.confirm",
      "opnames.view_all",
      "approvals.view",
      "reports.view",
      "reports.export",
      "notifications.view",
    ],
  },
  {
    code: "KEPALA_BAGIAN",
    name: "Kepala Bagian",
    description: "Mengawasi stok bagian sendiri dan menyetujui koreksi.",
    permissions: [
      "dashboard.view",
      "items.view",
      "departments.view",
      "stocks.view",
      "receipts.confirm",
      "adjustments.request",
      "opnames.create",
      "approvals.view",
      "approvals.decide",
      "reports.view",
      "reports.export",
      "notifications.view",
    ],
  },
  {
    code: "PIC",
    name: "PIC / Penanggung Jawab Barang",
    description:
      "Mencatat pemakaian, retur, rusak/hilang, dan stok opname bagian.",
    permissions: [
      "dashboard.view",
      "items.view",
      "departments.view",
      "stocks.view",
      "receipts.confirm",
      "consumptions.create",
      "returns.create",
      "damages.create",
      "adjustments.request",
      "opnames.create",
      "approvals.view",
      "reports.view",
      "reports.export",
      "notifications.view",
    ],
  },
  {
    code: "AUDITOR",
    name: "Auditor",
    description:
      "Akses baca transaksi, kartu stok, dan audit trail lintas bagian.",
    permissions: [
      "dashboard.view",
      "dashboard.view_all",
      "items.view",
      "departments.view",
      "imports.view",
      "stocks.view",
      "stocks.view_all",
      "opnames.view_all",
      "approvals.view",
      "reports.view",
      "reports.export",
      "audit.view",
      "notifications.view",
    ],
  },
];

export const DEPARTMENTS: Array<[string, string]> = [
  ["DEPT-01", "Aftap"],
  ["DEPT-02", "Mobile Unit"],
  ["DEPT-03", "Admin Donor"],
  ["DEPT-04", "Kasir"],
  ["DEPT-05", "Humas"],
  ["DEPT-06", "Kepegawaian"],
  ["DEPT-07", "Logistik"],
  ["DEPT-08", "Service Donor"],
  ["DEPT-09", "Penunjang"],
  ["DEPT-10", "IMLTD"],
  ["DEPT-11", "Konfirmasi Golongan Darah"],
  ["DEPT-12", "Pengelolaan Komponen dan Penyimpanan Darah"],
  ["DEPT-13", "Pasien Service dan Distribusi Darah"],
  ["DEPT-14", "Keuangan"],
  ["DEPT-15", "P2D2S"],
  ["DEPT-16", "Konseling"],
  ["DEPT-17", "PPI"],
  ["DEPT-18", "Dokumentasi dan Hemovigilance"],
  ["DEPT-19", "Diklat dan Pengembangan"],
  ["DEPT-20", "Seleksi Donor Dalam Gedung"],
  ["DEPT-21", "Seleksi Donor Mobile Unit"],
  ["DEPT-22", "Mutu Pengembangan dan Produk Rilis"],
  ["DEPT-23", "Logistik dan Pengadaan"],
];

const UNITS: Array<[string, string]> = [
  ["PCS", "Pcs"],
  ["PACK", "Pack"],
  ["BOX", "Box"],
  ["RIM", "Rim"],
  ["BOTOL", "Botol"],
  ["UNIT", "Unit"],
  ["KG", "Kilogram"],
  ["LITER", "Liter"],
  ["SET", "Set"],
  ["ROLL", "Roll"],
];

const CATEGORIES = [
  "Alat Tulis Kantor",
  "Bahan Medis",
  "Rumah Tangga",
  "Cetak dan Dokumen",
  "Perangkat",
  "Lainnya",
];

const DEFAULT_SETTINGS: Record<string, string> = {
  app_name: "Sistem Monitoring Stok dan Pemakaian Per Bagian",
  organization_name: "Unit Transfusi Darah",
  receipt_mode: "confirm",
  adjustment_approval_threshold: "1",
  opname_period: "bulanan",
  late_input_days: "3",
  import_mapping: "",
};

export function seedBase(): { createdAdmin: boolean; adminUsername: string } {
  const db = getDb();
  let createdAdmin = false;
  withTx((tx) => {
    const now = nowIso();

    for (const [code, description] of PERMISSIONS) {
      tx.prepare(
        "INSERT OR IGNORE INTO permissions (code, description) VALUES (?, ?)",
      ).run(code, description);
    }
    const permRows = tx
      .prepare("SELECT id, code FROM permissions")
      .all() as Array<{ id: number; code: string }>;
    const permMap = new Map(permRows.map((p) => [p.code, p.id]));

    for (const role of ROLES) {
      tx.prepare(
        "INSERT OR IGNORE INTO roles (code, name, description, created_at) VALUES (?, ?, ?, ?)",
      ).run(role.code, role.name, role.description, now);
      const roleRow = tx
        .prepare("SELECT id FROM roles WHERE code = ?")
        .get(role.code) as { id: number };
      for (const permission of role.permissions) {
        const permissionId = permMap.get(permission);
        if (!permissionId) continue;
        tx.prepare(
          "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
        ).run(roleRow.id, permissionId);
      }
    }

    for (const [code, name] of DEPARTMENTS) {
      tx.prepare(
        "INSERT OR IGNORE INTO departments (code, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
      ).run(code, name, now, now);
    }

    for (const [code, name] of UNITS) {
      tx.prepare(
        "INSERT OR IGNORE INTO units (code, name, created_at) VALUES (?, ?, ?)",
      ).run(code, name, now);
    }

    for (const name of CATEGORIES) {
      tx.prepare(
        "INSERT OR IGNORE INTO item_categories (name, created_at) VALUES (?, ?)",
      ).run(name, now);
    }

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      tx.prepare(
        "INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)",
      ).run(key, value, now);
    }

    const adminExists = tx.prepare("SELECT 1 AS ok FROM users LIMIT 1").get();
    if (!adminExists) {
      const role = tx
        .prepare("SELECT id FROM roles WHERE code = 'SUPER_ADMIN'")
        .get() as { id: number };
      tx.prepare(
        `INSERT INTO users (username, name, password_hash, role_id, is_active, must_change_password, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 0, ?, ?)`,
      ).run(
        config.seedAdminUsername,
        config.seedAdminName,
        hashPassword(config.seedAdminPassword),
        role.id,
        now,
        now,
      );
      createdAdmin = true;
    }
  });

  if (createdAdmin && !config.isProduction) {
    console.log(
      `[seed] Akun administrator dibuat: ${config.seedAdminUsername} / ${config.seedAdminPassword} (segera ganti kata sandi).`,
    );
  }
  return { createdAdmin, adminUsername: config.seedAdminUsername };
}
