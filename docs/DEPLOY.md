# Panduan Deploy: GitHub (private) + Supabase + Vercel

## Ringkasan arsitektur

- Aplikasi: Express (API) + React (SPA), satu kode.
- Database: **PostgreSQL di Supabase** (menggantikan SQLite). API database sinkron
  di `server/src/db.ts` menjembatani kode lama dengan Postgres via worker thread.
- Skema didefinisikan di `server/src/migrations/index.ts` dan dibuat otomatis saat
  server pertama kali jalan (tabel `schema_migrations` mencatat migrasi yang sudah jalan).
- Deploy: Vercel menjalankan API (`api/index.ts`) dan menyajikan `client/dist`.

## Langkah 1 — Buat proyek Supabase

1. Daftar/masuk ke https://supabase.com → **New project**.
2. Simpan password database (akan dipakai di connection string).
3. Region terdekat: `Singapore (ap-southeast-1)`.

## Langkah 2 — Ambil connection string

Supabase Dashboard → **Project Settings → Database → Connection string → URI**:

- Untuk aplikasi (Vercel & lokal): pakai **Connection pooler** (port `6543`),
  mode `Transaction`:
  ```
  postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:6543/postgres
  ```
- Ganti `[YOUR-PASSWORD]` dengan password Langkah 1.

## Langkah 3 — Setup lokal

```bash
# 1. Isi kredensial (file ini di-gitignore, tidak ikut commit)
copy server\.env.example server\.env   # bila ada; jika tidak buat manual:
#   server/.env berisi satu baris:
#   DATABASE_URL=postgresql://postgres.xxx:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres

# 2. Jalankan aplikasi sekali → migrasi skema + seed admin berjalan otomatis
npm run dev:server
# Log sukses: "Server berjalan di http://localhost:3000". Matikan dengan Ctrl+C.

# 3. Pindahkan data lama (master barang, riwayat) dari SQLite ke Supabase
npm --workspace server exec tsx -- src/scripts/migrate-sqlite-to-pg.ts
# Script ini idempotent: tabel Postgres yang sudah berisi tidak ditimpa.

# 4. Uji login
npm run dev        # buka http://localhost:5173, login admin
```

## Langkah 4 — Push ke GitHub (private)

```bash
# Buat repo kosong PRIVATE bernama mis. stok-opname di github.com TANPA README.
git remote add origin https://github.com/<USERNAME>/<REPO>.git
git push -u origin main
```

## Langkah 5 — Deploy ke Vercel

1. https://vercel.com → **Add New → Project** → pilih repo GitHub tadi.
2. Framework Preset: **Other**. Build command & output sudah diatur `vercel.json`.
3. **Environment Variables** (Production + Preview):
   | Nama | Nilai |
   |---|---|
   | `DATABASE_URL` | connection string pooler 6543 (Langkah 2) |
   | `SESSION_SECRET` | string acak ≥32 karakter: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
   | `NODE_ENV` | `production` |
   | `SEED_ADMIN_PASSWORD` | (opsional) ganti password admin awal sebelum seed pertama jalan |
   | `COOKIE_SECURE` | `true` |
4. **Deploy**. Saat request pertama masuk, migrasi skema + seed admin jalan otomatis.
5. Login ke aplikasi dengan akun admin (default `admin` / password `SEED_ADMIN_PASSWORD`
   atau `Admin#12345` bila tidak diubah — **ganti setelah login pertama**).

## Catatan penting

- **Rate limit/login**: modul rate-limit login disimpan di memori proses; pada
  serverless batas per-instance (efeknya lebih longgar). Tolerabel untuk skala internal.
- **Jangan simpan file di disk** — lingkungan serverless tidak persisten.
- Backup: gunakan fitur **Backups** Supabase (dashboard) sebagai pengganti
  `docs/BACKUP_RESTORE.md` yang untuk SQLite.
- Skema baru: tambahkan entri di `server/src/migrations/index.ts` (jangan edit entri lama).
