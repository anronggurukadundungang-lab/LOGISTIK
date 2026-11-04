# Backup dan Restore

Database utama berada di `data/stok.db` (SQLite mode WAL). Semua data transaksi, master, pengguna, audit, dan konfigurasi tersimpan di file tersebut. Folder `data/backups/` menyimpan salinan backup.

> Backup tidak boleh dianggap berhasil sebelum file diuji dengan `PRAGMA integrity_check` dan aplikasi diuji login.

## 1. Backup dari aplikasi (disarankan)

1. Login sebagai **Super Admin**.
2. Buka **Pengaturan**.
3. Pada bagian backup, klik **Buat Backup**.
4. Sistem menjalankan checkpoint WAL dan `VACUUM INTO` sehingga menghasilkan file konsisten meskipun aplikasi berjalan.
5. File tersimpan di `data/backups/stok-backup-YYYY-MM-DDTHH-MM-SS.db`.
6. Unduh file melalui tombol unduh pada daftar backup.

Backup manual dari UI juga dicatat di audit trail (`CREATE_BACKUP`).

## 2. Backup terjadwal (cron / Task Scheduler)

Aplikasi belum memiliki penjadwal internal. Gunakan penjadwal sistem.

### Linux/macOS

Buat skrip `backup-stok.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
APP_DIR="/opt/stok-opname"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$APP_DIR/data/backups/stok-backup-$STAMP.db"
mkdir -p "$APP_DIR/data/backups"
cd "$APP_DIR"
node --input-type=module -e "
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/stok.db');
db.exec('PRAGMA wal_checkpoint(FULL);');
db.prepare('VACUUM INTO ?').run(process.argv.at(-1));
db.close();
" "$DEST"
# Simpan 30 hari terakhir
find "$APP_DIR/data/backups" -name 'stok-backup-*.db' -mtime +30 -delete
```

Jadwalkan harian pukul 01.00:

```cron
0 1 * * * /opt/stok-opname/backup-stok.sh >> /var/log/stok-backup.log 2>&1
```

### Windows PowerShell

```powershell
$AppDir = "D:\STOK OPNAME"
$Stamp  = Get-Date -Format "yyyyMMdd-HHmmss"
$Dest   = Join-Path $AppDir "data\backups\stok-backup-$Stamp.db"
New-Item -ItemType Directory -Force -Path (Join-Path $AppDir "data\backups") | Out-Null
Set-Location $AppDir
@"
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/stok.db');
db.exec('PRAGMA wal_checkpoint(FULL);');
db.prepare('VACUUM INTO ?').run(process.argv.at(-1));
db.close();
"@ | node --input-type=module - "$Dest"
```

Daftarkan di Task Scheduler harian. Hapus backup lama secara berkala.

## 3. Backup offline (aplikasi dihentikan)

Cara paling aman bila Anda dapat menghentikan aplikasi:

1. Hentikan server.
2. Salin **ketiga** file berikut bila ada:
   - `data/stok.db`
   - `data/stok.db-wal`
   - `data/stok.db-shm`
3. Simpan ke media/berkas terpisah.

Jika hanya menyalin `stok.db` saat aplikasi berhenti normal, WAL biasanya sudah checkpoint. Namun menyalin ketiga file lebih aman. Jangan menyalin file DB saat aplikasi sedang menulis tanpa mekanisme `VACUUM INTO`.

## 4. Verifikasi backup

### Integritas file

```bash
node --input-type=module -e "
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/backups/stok-backup-XXXX.db', { readOnly: true });
console.log(db.prepare('PRAGMA integrity_check').all());
console.log('users:', db.prepare('SELECT COUNT(*) c FROM users').get().c);
console.log('entries:', db.prepare('SELECT COUNT(*) c FROM stock_entries').get().c);
db.close();
"
```

Hasil yang diharapkan: `integrity_check` = `ok`.

### Verifikasi aplikasi

1. Restore ke lingkungan uji (bukan produksi).
2. Jalankan aplikasi.
3. Login, buka **Dashboard**, **Monitoring Stok**, **Kartu Stok**, dan **Laporan**.
4. Buka **Pengaturan** → pemeriksaan integritas; tidak boleh ada selisih cache vs ledger.

## 5. Restore

> Restore menimpa seluruh data saat ini. Backup database aktif terlebih dahulu.

1. Hentikan aplikasi.
2. Cadangkan database yang sekarang:
   ```bash
   mv data/stok.db data/stok.db.sebelum-restore
   mv data/stok.db-wal data/stok.db-wal.sebelum-restore 2>/dev/null || true
   mv data/stok.db-shm data/stok.db-shm.sebelum-restore 2>/dev/null || true
   ```
3. Salin file backup ke `data/stok.db`:
   ```bash
   cp data/backups/stok-backup-XXXX.db data/stok.db
   ```
4. Pastikan kepemilikan file sesuai user aplikasi:
   ```bash
   chown stok:stok data/stok.db
   chmod 640 data/stok.db
   ```
5. Jalankan `npm run migrate` untuk memastikan skema sesuai versi aplikasi.
6. Jalankan aplikasi dan uji login serta beberapa halaman.
7. Jika ada masalah, hentikan aplikasi dan kembalikan file `.sebelum-restore`.

Windows PowerShell:

```powershell
Rename-Item "data\stok.db" "stok.db.sebelum-restore"
Copy-Item "data\backups\stok-backup-XXXX.db" "data\stok.db"
npm run migrate
npm start
```

## 6. Setelah restore

- Periksa `data/backups/` tidak ikut tertimpa.
- Cek audit trail terakhir dan jumlah transaksi.
- Buka **Pengaturan** → **Pemeriksaan Integritas**. Jika cache saldo tidak cocok dengan ledger, jalankan **Hitung ulang saldo** (tercatat di audit).
- Pastikan tidak ada sesi lama yang masih valid. Semua sesi tersimpan di database backup; bila perlu, minta pengguna login ulang atau hapus tabel `sessions` pada salinan database.
- Uji ekspor Excel/PDF dan impor file kecil.

## 7. Retensi dan penyimpanan

Saran:

- Backup harian, simpan minimal 30 hari.
- Backup bulanan, simpan minimal 12 bulan.
- Simpan minimal satu salinan di lokasi/media berbeda.
- Enkripsi media backup bila berisi data pribadi.
- Batasi akses folder `data/` dan `data/backups/` hanya untuk user aplikasi/administrator.
- Uji restore secara berkala, bukan hanya membuat backup.

## 8. Rencana pemulihan bencana singkat

1. Siapkan server baru dengan Node.js 24+.
2. Pasang kode aplikasi dan `npm install`.
3. Salin `.env` produksi (secret, path DB).
4. Salin backup terbaru ke `data/stok.db`.
5. `npm run migrate`, `npm run build`, lalu jalankan service.
6. Verifikasi `/api/health`, login, dashboard, dan integritas saldo.
7. Arahkan domain/reverse proxy ke server baru.
