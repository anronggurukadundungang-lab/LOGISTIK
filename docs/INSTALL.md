# Instalasi dan Deployment

Panduan ini mencakup instalasi development, build produksi, konfigurasi, dan troubleshooting.

## 1. Prasyarat

- **Node.js 24+** (disarankan LTS terbaru atau Node 26). Aplikasi memakai modul bawaan `node:sqlite` yang tidak tersedia pada Node lama.
- npm 10+.
- Ruang disk untuk database SQLite dan backup.
- Untuk produksi: reverse proxy HTTPS (Nginx/Caddy/IIS) dan proses manager (systemd/NSSM/PM2) bila perlu.

Periksa versi:

```bash
node --version
npm --version
```

## 2. Instalasi development

```bash
npm install
cp .env.example .env        # Linux/macOS
copy .env.example .env      # Windows PowerShell/CMD
```

Sesuaikan minimal:

```ini
PORT=3000
NODE_ENV=development
DATABASE_PATH=../data/stok.db
SESSION_SECRET=string-acak-minimal-64-karakter
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=Admin#12345
```

Buat secret acak:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Jalankan:

```bash
npm run dev
```

Akses <http://localhost:5173>. Vite mem-proxy `/api` ke `http://localhost:3000`.

Pada start pertama:

1. Folder `data/` dibuat otomatis.
2. Migrasi `server/src/migrations/001_init.sql` dijalankan.
3. Seed membuat role, permission, 23 bagian, satuan, kategori, pengaturan, dan akun admin.
4. Log server menampilkan akun admin yang dibuat (hanya di mode development).

## 3. Build dan jalankan produksi

```bash
npm install
npm run build
```

Hasil frontend ada di `client/dist`. Server Express otomatis menyajikan file statis tersebut bila foldernya ada, termasuk fallback SPA.

Linux/macOS:

```bash
export NODE_ENV=production
export SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
export COOKIE_SECURE=true
export APP_URL=https://stok.contoh.go.id
npm start
```

Windows PowerShell:

```powershell
$env:NODE_ENV="production"
$env:SESSION_SECRET="isi-string-acak-panjang"
$env:COOKIE_SECURE="true"
$env:APP_URL="https://stok.contoh.go.id"
npm start
```

Buka `http://localhost:3000` atau domain reverse proxy Anda.

### Catatan produksi

- **Ganti password admin** setelah login pertama.
- Set `SESSION_SECRET` yang kuat dan unik. Jangan memakai default.
- Aktifkan HTTPS dan `COOKIE_SECURE=true`.
- Batasi akses langsung ke port aplikasi; hanya reverse proxy yang boleh mengakses.
- Jangan menaruh `.env` atau folder `data/` di web root.
- Backup database secara rutin (lihat `docs/BACKUP_RESTORE.md`).

## 4. Reverse proxy contoh (Nginx)

```nginx
server {
    listen 443 ssl http2;
    server_name stok.contoh.go.id;

    ssl_certificate     /etc/ssl/certs/stok.crt;
    ssl_certificate_key /etc/ssl/private/stok.key;

    client_max_body_size 12m;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

`app.set("trust proxy", 1)` sudah aktif agar IP klien dan cookie aman terbaca di belakang satu proxy.

## 5. Menjalankan sebagai service

### systemd (Linux)

```ini
[Unit]
Description=Monitoring Stok Per Bagian
After=network.target

[Service]
Type=simple
User=stok
WorkingDirectory=/opt/stok-opname
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=DATABASE_PATH=../data/stok.db
EnvironmentFile=/opt/stok-opname/.env
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now stok-opname
sudo journalctl -u stok-opname -f
```

### NSSM (Windows)

```powershell
nssm install StokOpname "C:\Program Files\nodejs\npm.cmd" "start"
nssm set StokOpname AppDirectory "D:\STOK OPNAME"
nssm set StokOpname AppEnvironmentExtra NODE_ENV=production
nssm start StokOpname
```

## 6. Migrasi dan seed manual

Biasanya dijalankan otomatis saat server start. Untuk menjalankan manual:

```bash
npm run migrate
npm run seed
```

Seed bersifat idempoten: data yang sudah ada tidak diduplikasi. Admin hanya dibuat jika tabel `users` masih kosong.

## 7. Reset database (development)

> Semua data akan hilang. Lakukan backup terlebih dahulu.

1. Hentikan server.
2. Hapus `data/stok.db`, `data/stok.db-shm`, `data/stok.db-wal`.
3. Jalankan `npm start`. Database baru dibuat dan di-seed ulang.

## 8. Verifikasi instalasi

```bash
npm run typecheck
npm test
npm run build
```

Cek kesehatan API:

```bash
curl http://localhost:3000/api/health
# {"status":"ok","time":"..."}
```

Cek login:

```bash
curl -i -c cookies.txt -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin#12345"}' \
  http://localhost:3000/api/auth/login
```

## 9. Troubleshooting

| Gejala | Penyebab umum | Solusi |
|---|---|---|
| `Cannot find module 'node:sqlite'` | Node terlalu lama | Upgrade ke Node 24+ |
| `EADDRINUSE :3000` | Port dipakai proses lain | Hentikan proses atau ubah `PORT` |
| Login berhasil tetapi mutasi 403 CSRF | Token tidak terkirim | Muat ulang halaman; pastikan frontend memakai API client bawaan |
| Cookie tidak tersimpan di HTTPS | `COOKIE_SECURE` salah | Set `COOKIE_SECURE=true` hanya di HTTPS |
| Impor ditolak `format file` | Ekstensi bukan `.pdf`/`.xlsx`/`.csv` | Simpan ulang file `.xls` menjadi `.xlsx`, atau unggah PDF ekspor SIMDONDAR yang berbasis teks (bukan hasil pindai) |
| File impor terlalu besar | Melebihi `MAX_UPLOAD_BYTES` | Perkecil file atau naikkan batas dan `client_max_body_size` proxy |
| Saldo tidak sesuai | Ada transaksi setelah snapshot opname | Buat sesi opname baru; jangan menyetujui snapshot lama |
| `database is locked` | Proses lain menulis bersamaan | Pastikan hanya satu instance aplikasi memakai file DB yang sama |

## 10. Peningkatan versi

1. Backup database.
2. Hentikan aplikasi.
3. Ganti kode dan jalankan `npm install`.
4. Jalankan `npm run migrate` (migrasi baru akan diterapkan).
5. `npm run build` bila frontend berubah.
6. Jalankan kembali aplikasi dan cek `/api/health`.
