# Sistem Monitoring Stok dan Pemakaian Per Bagian

Aplikasi web pendamping **SIMDONDAR** untuk mencatat dan memantau stok barang per bagian setelah barang dikeluarkan Logistik. Aplikasi ini bukan pengganti SIMDONDAR: permintaan dan pengeluaran tetap dilakukan di SIMDONDAR, lalu hasil ekspornya diimpor ke sini.

## Fitur utama

- **Impor SIMDONDAR** PDF, Excel, atau CSV dengan pemetaan kolom, pratinjau, validasi baris, anti-duplikat berbasis nomor dokumen + nomor baris, cadangan fingerprint isi, riwayat batch, dan unduhan laporan kesalahan. Barang/bagian yang belum ada di master dapat dibuat otomatis saat validasi (opsional, perlu izin kelola master). Kolom **Harga @ (Rp.)** dan **Total (Rp.)** pada PDF tidak diimpor.
- **Penerimaan barang** dari hasil impor, dengan mode konfirmasi manual (default) atau otomatis.
- **Pemakaian multi-baris** dengan autocomplete barang, stok tersedia real-time, konversi satuan, dan validasi stok negatif.
- **Retur, rusak, hilang, kedaluwarsa, penyesuaian, dan koreksi pemakaian** dengan alur persetujuan.
- **Stok opname** per bagian: snapshot sistem, isi jumlah fisik, ajukan, setujui/tolak; saldo baru berubah setelah disetujui.
- **Ledger append-only**: saldo dihitung dari `opening + penerimaan − pemakaian − retur − rusak/hilang/kedaluwarsa ± penyesuaian`. Tidak ada penimpaan saldo langsung.
- **Dashboard** Wakil Kepala, Logistik, Kepala Bagian, dan PIC dengan filter tanggal/bagian/kategori, grafik, stok menipis, input terlambat, opname, dan antrean persetujuan.
- **12 jenis laporan** dengan filter dan ekspor Excel/PDF.
- **RBAC 7 role** dan pembatasan bagian yang ditegakkan di backend.
- **Audit trail**, notifikasi, pengaturan sistem, dan backup database dari UI.
- UI berbahasa Indonesia, responsif, dengan menu sidebar sesuai izin pengguna.

## Teknologi

| Lapisan | Teknologi |
|---|---|
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS 4, Recharts |
| Backend | Node.js, Express 5, TypeScript (`tsx`), Zod |
| Database | SQLite (WAL) melalui `node:sqlite` bawaan Node.js |
| Berkas | ExcelJS (impor/ekspor), pdfjs-dist (baca PDF SIMDONDAR), PDFKit (laporan PDF), Multer (upload) |
| Pengujian | Vitest + Supertest |

## Prasyarat

- **Node.js 24 atau lebih baru** (wajib: modul `node:sqlite`; proyek diuji pada Node 26).
- npm 10+.
- Windows, Linux, atau macOS. Panduan perintah memakai contoh Windows/PowerShell dan Linux/macOS.

## Menjalankan cepat (development)

```bash
npm install
copy .env.example .env        # Windows
# cp .env.example .env        # Linux/macOS

npm run dev
```

- Frontend: <http://localhost:5173>
- API: <http://localhost:3000/api>
- Login awal: **admin** / **Admin#12345**

Ganti kata sandi admin setelah login pertama. Database dibuat otomatis di `data/stok.db` dan seed awal mengisi 23 bagian, 7 role, 25 permission, satuan, kategori, serta pengaturan dasar.

### Menjalankan terpisah

```bash
npm run dev:server
npm run dev:client
```

### Perintah penting

| Perintah | Kegunaan |
|---|---|
| `npm run dev` | Server API + Vite sekaligus |
| `npm run dev:server` | Server API dengan watch mode |
| `npm run dev:client` | Frontend Vite |
| `npm run build` | Build frontend ke `client/dist` |
| `npm start` | Jalankan server API (sekaligus menyajikan `client/dist` bila ada) |
| `npm run typecheck` | Typecheck server dan client |
| `npm test` | Tes integrasi backend (Vitest + Supertest) |
| `npm run migrate` | Jalankan migrasi database |
| `npm run seed` | Seed data dasar (idempoten) |

## Build produksi

```bash
npm install
npm run build
set NODE_ENV=production
set SESSION_SECRET=<string-acak-panjang>
npm start
```

Server menyajikan API dan frontend dari port `3000` (dapat diubah lewat `PORT`). Untuk HTTPS, tempatkan di belakang reverse proxy (Nginx/Caddy/IIS), set `COOKIE_SECURE=true`, dan gunakan `APP_URL` yang sesuai.

Rincian langkah, konfigurasi, dan troubleshooting ada di [docs/INSTALL.md](docs/INSTALL.md).

## Peran pengguna

| Role | Kewenangan utama |
|---|---|
| Super Admin | Semua fitur, pengguna, master, pengaturan, audit, backup |
| Wakil Kepala | Monitoring dan laporan lintas bagian (baca saja) |
| Kabid Logistik | Impor, master, penerimaan, persetujuan koreksi, laporan |
| Staf Logistik | Impor, penerimaan, monitoring, laporan |
| Kepala Bagian | Stok bagian sendiri, penerimaan, opname, persetujuan |
| PIC | Pemakaian, retur, rusak/hilang, opname bagian sendiri |
| Auditor | Baca transaksi, kartu stok, laporan, audit lintas bagian |

Panduan penggunaan per alur ada di [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

## Struktur proyek

```
server/
  src/
    migrations/        skema SQL
    routes/            endpoint API per domain
    services/          logika stok, impor, workflow, laporan, ekspor
    lib/               auth, sesi, password, HTTP helper
    seed.ts            role, permission, bagian, pengaturan awal
  tests/               tes integrasi API
client/
  src/
    pages/             halaman aplikasi
    components/        layout dan komponen UI
    context/           auth dan toast
    lib/               API client dan formatter
docs/                  analisis, instalasi, panduan, backup
data/                  database SQLite dan backup (tidak masuk git)
```

## Keamanan

- Password di-hash dengan `scrypt` dan salt acak.
- Sesi disimpan di server; cookie `httpOnly`, `SameSite=Lax`, dan `Secure` bila diaktifkan.
- Mutasi API memakai proteksi CSRF double-submit (`X-CSRF-Token`).
- Otorisasi role dan cakupan bagian diperiksa di backend, bukan hanya di UI.
- Query memakai prepared statement; input divalidasi dengan Zod.
- Upload dibatasi tipe `.xlsx`/`.csv`/`.pdf`, ukuran maksimum, dan disimpan di memori sebelum diproses.
- Header keamanan: CSP, `X-Frame-Options: DENY`, `nosniff`, referrer policy.
- Rate limit login dan penguncian akun sementara setelah percobaan gagal berulang.
- Audit trail untuk login, impor, transaksi, persetujuan, perubahan master/pengguna/pengaturan, dan backup.

## Keterbatasan dan asumsi

- **Contoh ekspor SIMDONDAR asli belum tersedia.** Karena itu kolom impor dibuat dapat dipetakan pengguna; format final tidak diasumsikan. Lihat `docs/ANALYSIS.md` bagian asumsi.
- Aplikasi mengutamakan kuantitas; valuasi rupiah belum termasuk MVP.
- Backup otomatis terjadwal belum disediakan; backup dapat dibuat dari UI atau cron eksternal (lihat `docs/BACKUP_RESTORE.md`).
- Notifikasi bersifat in-app, belum email/WhatsApp.
- Laporan PDF memakai kop sederhana, belum tanda tangan digital.

## Dokumentasi

- [Analisis dan desain](docs/ANALYSIS.md)
- [Instalasi dan produksi](docs/INSTALL.md)
- [Panduan pengguna](docs/USER_GUIDE.md)
- [Backup dan restore](docs/BACKUP_RESTORE.md)
- [Contoh berkas impor](docs/contoh-import-simdondar.csv)
