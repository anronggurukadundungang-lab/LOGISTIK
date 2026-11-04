# Panduan Pengguna

Panduan ini menjelaskan penggunaan aplikasi **Sistem Monitoring Stok dan Pemakaian Per Bagian** untuk setiap peran.

## 1. Masuk dan keluar

1. Buka alamat aplikasi.
2. Isi **Nama pengguna** dan **Kata sandi**.
3. Klik **Masuk**.

- Setelah login, token keamanan sesi dimuat otomatis. Jangan membuka aplikasi di dua tab berbeda tanpa memuat ulang setelah logout.
- Bila kata sandi Anda direset administrator, segera ganti melalui menu pengguna di kanan atas → **Ubah kata sandi**.
- Sesi berakhir otomatis setelah masa berlaku (default 8 jam) atau saat logout.
- Menu sidebar hanya menampilkan halaman yang boleh Anda akses. Akses langsung ke URL terlarang tetap ditolak backend.

## 2. Peran dan cakupan data

| Role | Dapat melakukan |
|---|---|
| Super Admin | Semua modul, master, pengguna, pengaturan, audit, backup |
| Wakil Kepala | Melihat dashboard dan laporan semua bagian; tanpa transaksi |
| Kabid Logistik | Impor, master, penerimaan, persetujuan koreksi, laporan semua bagian |
| Staf Logistik | Impor, penerimaan, monitoring, laporan semua bagian |
| Kepala Bagian | Melihat dan menerima barang bagian sendiri, opname, menyetujui pengajuan |
| PIC | Mencatat pemakaian/retur/rusak/hilang, opname bagian sendiri |
| Auditor | Melihat transaksi, kartu stok, laporan, dan audit semua bagian |

**Penting:** pengguna dengan cakupan bagian hanya melihat data bagian yang ditugaskan. Permintaan ke bagian lain akan ditolak (403). Pengaju tidak dapat menyetujui pengajuannya sendiri.

## 3. Dashboard

Menu **Dashboard** menampilkan:

- Total saldo stok, jumlah barang aktif, dan jumlah bagian dalam cakupan.
- Pemakaian periode terpilih.
- Baris stok menipis dan habis.
- Jumlah persetujuan menunggu dan penerimaan belum dikonfirmasi.
- Grafik tren pemakaian, barang paling banyak dipakai, saldo per bagian, dan pemakaian per bagian.
- Tabel stok menipis, input terlambat, opname terbaru, antrean persetujuan, impor terbaru, dan transaksi terbaru.

Gunakan filter **Dari tanggal**, **Sampai tanggal**, **Bagian**, dan **Kategori**. Klik kartu ringkasan atau tautan untuk berpindah ke halaman terkait. Tombol **Muat ulang** mengambil data terbaru.

## 4. Monitoring stok dan kartu stok

Menu **Monitoring Stok** menampilkan saldo per barang per bagian:

- Cari barang berdasarkan nama/kode.
- Filter bagian, kategori, dan status (**Aman**, **Menipis**, **Habis**).
- Kolom total penerimaan, pemakaian, retur, rusak/hilang, dan hasil opname terakhir.
- Klik baris/kartu untuk membuka **Kartu Stok**.

**Kartu Stok** menampilkan seluruh ledger barang tersebut pada satu bagian: nomor transaksi, tipe, qty masuk/keluar, saldo setelah transaksi, tanggal, keterangan, dan pembuat. Gunakan filter tanggal dan pagination. Ekspor kartu stok ke Excel tersedia di halaman ini.

Saldo tidak dapat diedit langsung. Semua perubahan berasal dari transaksi yang tercatat.

## 5. Mencatat pemakaian

Menu **Pemakaian** → tab **Catat Pemakaian**:

1. Pilih **Bagian**.
2. Pilih **Tanggal pemakaian** (tidak boleh melewati hari ini).
3. Isi **Kategori kegiatan** dan **Petugas/pemakai** bila perlu.
4. Pada baris barang, ketik nama/kode untuk mencari, lalu pilih barang.
5. Sistem menampilkan **stok tersedia**. Pilih satuan bila barang memiliki konversi.
6. Isi **Jumlah** dan keterangan.
7. Klik **Tambah Baris** untuk barang lain (maksimal 50 baris).
8. Klik **Simpan Pemakaian**.

Jika jumlah melebihi stok, sistem menolak penyimpanan. Satu baris menjadi satu transaksi ledger dengan nomor sendiri.

Tab **Riwayat Pemakaian** menampilkan pemakaian terbaru. Dari sini Anda dapat mengajukan **Koreksi** bila jumlah salah. Koreksi memerlukan alasan minimal 10 karakter dan persetujuan; transaksi asli tidak dihapus, tetapi dibalik dan diganti.

## 6. Retur, rusak, hilang, kedaluwarsa, penyesuaian

Pada halaman **Pemakaian**, tombol di kanan atas membuka formulir:

| Tombol | Efek saldo | Persetujuan |
|---|---|---|
| **Retur** | Langsung berkurang (barang kembali ke Logistik) | Tidak |
| **Rusak** | Berkurang setelah disetujui | Ya |
| **Hilang** | Berkurang setelah disetujui | Ya |
| **Kedaluwarsa** | Berkurang setelah disetujui | Ya |
| **Penyesuaian** | Bertambah/berkurang setelah disetujui | Ya |

Isi barang, jumlah, tanggal, catatan, dan alasan. Pengajuan masuk ke menu **Persetujuan**. Selama belum disetujui, saldo tidak berubah.

## 7. Menerima barang dari SIMDONDAR

Menu **Penerimaan** menampilkan transaksi hasil impor yang berstatus **AWAITING_RECEIPT**.

1. Periksa nomor dokumen, barang, jumlah keluar, satuan, dan bagian.
2. Klik **Konfirmasi**.
3. Sesuaikan **Jumlah diterima** bila fisik berbeda dari jumlah keluar.
4. Tambahkan catatan bila perlu, lalu simpan.

Konfirmasi membuat transaksi penerimaan dan menambah saldo bagian. Bila barang tidak sesuai, gunakan **Sengketa** dengan alasan; transaksi ditandai `DISPUTED` dan tidak menambah saldo.

Jika pengaturan `receipt_mode=auto`, penerimaan langsung menambah saldo saat impor di-commit tanpa konfirmasi manual. Gunakan mode ini hanya bila alur organisasi memang mengizinkan.

## 8. Impor berkas SIMDONDAR

Menu **Impor SIMDONDAR**.

### 8.1 Unggah

1. Klik **Unggah Berkas**.
2. Pilih file `.pdf`, `.xlsx`, atau `.csv` (maksimum default 10 MB).
3. Sistem membaca header dan menampilkan halaman **Detail Impor**.

Untuk PDF ekspor SIMDONDAR, sistem mengambil nomor transaksi, tanggal, bagian penerima, barang, satuan, qty diminta, dan qty keluar. Kolom **Harga @ (Rp.)** dan **Total (Rp.)** sengaja tidak diimpor. PDF harus berbasis teks, bukan hasil pindai/gambar.

File `.xls` lama harus disimpan ulang sebagai `.xlsx`.

### 8.2 Petakan kolom

Petakan kolom file ke field sistem:

| Field | Wajib | Keterangan |
|---|---|---|
| Tanggal Pengeluaran | Ya | Tanggal transaksi |
| Qty Keluar | Ya | Jumlah barang keluar |
| Kode Barang / Nama Barang | Minimal salah satu | Untuk mencocokkan master barang |
| Kode Bagian / Nama Bagian Penerima | Minimal salah satu | Untuk mencocokkan bagian |
| Nomor Dokumen | Disarankan | Kunci anti-duplikat utama |
| Nomor Baris | Disarankan | Melengkapi kunci anti-duplikat |
| Satuan | Opsional | Dipakai untuk konversi |
| Qty Diminta / Qty Disetujui | Opsional | Disimpan sebagai informasi |
| Keterangan | Opsional | Catatan |

Pemetaan terakhir disimpan dan dipakai sebagai saran pada unggahan berikutnya. Kolom bertanda wajib harus dipetakan sebelum validasi.

Jika Anda memiliki izin kelola master (`items.manage` dan/atau `departments.manage`), sebelum validasi bisa mencentang **Buat otomatis barang & bagian yang belum ada di master**. Baris yang merujuk barang/bagian yang belum ada di master akan dibuat otomatis saat validasi:

- **Barang** memakai kode dari kolom Kode Barang (atau kode `BRG-…` bila kosong) dan satuan dasar dari kolom Satuan (atau `PCS` bila kosong/tidak dikenal).
- **Bagian** memakai kode dari kolom Kode Bagian (atau kode `DEPT-…` bila kosong).
- Setiap pembuatan tercatat di audit trail dan baris terkait ditandai **Peringatan** (bukan Gagal), sehingga tetap dapat di-commit.

### 8.3 Validasi dan tinjau

Klik **Validasi Data**. Hasil dikelompokkan menjadi:

- **Valid** — siap di-commit.
- **Peringatan** — dapat di-commit, tetapi perlu diperiksa (misalnya nomor baris tidak tersedia).
- **Duplikat** — identitas dokumen sudah pernah diimpor; dilewati saat commit.
- **Gagal** — tidak dapat di-commit; perbaiki file atau pemetaan.

Periksa pratinjau baris. Unduh **laporan kesalahan** (Excel) untuk melihat detail baris gagal/duplikat/peringatan.

### 8.4 Commit

Klik **Commit Batch**. Commit tidak dapat dibatalkan. Baris valid/peringatan menjadi transaksi SIMDONDAR; baris duplikat/gagal dilewati. Pada mode konfirmasi, transaksi berstatus menunggu penerimaan.

Commit ulang batch yang sama ditolak. Unggah file yang sama juga terdeteksi duplikat berdasarkan nomor dokumen + baris. Jika hanya fingerprint isi yang sama (tanpa nomor dokumen), commit dapat memakai opsi **override** setelah ditinjau manual.

## 9. Stok opname

Menu **Stok Opname** → **Buat Sesi Opname**.

1. Pilih bagian dan tanggal opname.
2. Sistem mengambil snapshot semua barang yang pernah memiliki transaksi/saldo di bagian tersebut.
3. Isi **Jumlah fisik** setiap barang. Selisih dihitung otomatis terhadap stok sistem.
4. Isi alasan untuk barang yang selisih.
5. Klik **Ajukan Opname**. Saldo **belum berubah**.
6. Pengaju lain (Kepala Bagian/Kabid/Admin) membuka **Persetujuan** dan menyetujui/menolak.

Saat disetujui, setiap selisih dibukukan sebagai penyesuaian opname. Jika saldo berubah sejak snapshot dibuat, persetujuan ditolak agar koreksi tidak salah; buat sesi opname baru.

Sesi berstatus `DRAFT` dapat diubah. Setelah diajukan (`SUBMITTED`), rincian tidak dapat diubah. Sesi `APPROVED`/`REJECTED` bersifat final.

## 10. Persetujuan

Menu **Persetujuan** menampilkan pengajuan `PENDING` sesuai cakupan bagian:

- Penyesuaian stok
- Barang rusak/hilang/kedaluwarsa
- Koreksi pemakaian
- Stok opname

Buka detail untuk melihat ringkasan, alasan, pengaju, dan payload. Klik **Setujui** atau **Tolak** (alasan penolakan wajib). Anda tidak dapat menyetujui pengajuan sendiri. Persetujuan membukukan transaksi dan mengirim notifikasi ke pengaju.

## 11. Master data

- **Barang & Satuan** — tambah/ubah barang, kategori, satuan, dan konversi satuan. Kode barang harus unik. Stok minimum dipakai untuk peringatan stok menipis.
- **Bagian** — tambah/ubah 23 bagian awal, kode SIMDONDAR, nama kepala bagian, status aktif.
- **Pengguna & Role** — buat akun, tetapkan role dan bagian, aktif/nonaktifkan, reset kata sandi. Role Kepala Bagian/PIC wajib memiliki minimal satu bagian. Minimal satu Super Admin aktif harus tetap ada.

Menonaktifkan barang/bagian tidak menghapus riwayat. Barang/bagian nonaktif tidak dapat dipakai transaksi baru.

## 12. Laporan

Menu **Laporan** menyediakan 12 jenis laporan:

1. Pengeluaran Logistik (SIMDONDAR)
2. Penerimaan per Bagian
3. Pemakaian
4. Stok per Bagian
5. Kartu Stok
6. Stok Opname
7. Selisih Stok
8. Barang Rusak / Kedaluwarsa
9. Barang Hilang
10. Retur ke Logistik
11. Keterlambatan Input Pemakaian
12. Rekap Kebutuhan Pengadaan

Pilih filter tanggal, bagian, kategori, barang, atau status sesuai laporan. Klik **Ekspor Excel** atau **Ekspor PDF**. Data mengikuti cakupan bagian pengguna.

## 13. Audit trail

Menu **Audit Trail** menampilkan aktivitas sistem: waktu, pengguna, aksi, entitas, alasan, dan perubahan sebelum/sesudah (bila tersedia). Gunakan filter untuk menelusuri impor, transaksi, persetujuan, login, perubahan master, dan backup.

Audit tidak dapat dihapus dari UI.

## 14. Pengaturan dan backup

Menu **Pengaturan** (Super Admin) mencakup:

- Nama aplikasi dan organisasi.
- Mode penerimaan (`confirm`/`auto`).
- Ambang persetujuan penyesuaian.
- Periode opname dan batas hari input terlambat.
- Pemeriksaan integritas saldo: membandingkan cache saldo dengan ledger.
- **Hitung ulang saldo** dari ledger bila ditemukan selisih (tindakan tercatat di audit).
- **Buat backup** database dan unduh file backup.

Lihat `docs/BACKUP_RESTORE.md` untuk prosedur backup/restore lengkap.

## 15. Alur singkat harian

**Staf Logistik**
1. Ekspor pengeluaran dari SIMDONDAR.
2. Impor → petakan → validasi → commit.
3. Pantau dashboard dan laporan.

**PIC / Kepala Bagian**
1. Buka **Penerimaan**, konfirmasi barang yang datang.
2. Catat pemakaian harian.
3. Catat retur/rusak/hilang bila ada.
4. Lakukan opname sesuai periode.
5. Setujui pengajuan bila berwenang.

**Wakil Kepala / Auditor**
1. Buka dashboard dengan filter periode/bagian.
2. Periksa stok menipis, input terlambat, dan selisih opname.
3. Unduh laporan dan audit trail bila diperlukan.

## 16. Pertanyaan umum

**Mengapa saldo tidak berubah setelah saya mengajukan barang rusak?**  
Pengajuan rusak/hilang/kedaluwarsa/penyesuaian/koreksi/opname memerlukan persetujuan. Saldo berubah setelah disetujui.

**Mengapa tombol setujui tidak ada?**  
Anda tidak memiliki izin `approvals.decide`, atau pengajuan tersebut Anda buat sendiri.

**Mengapa barang tidak ditemukan saat impor?**  
Kode/nama barang belum ada di master, atau penulisannya berbeda. Anda dapat mencentang **Buat otomatis barang & bagian yang belum ada di master** saat validasi (perlu izin kelola master), atau tambahkan/benahi master barang lalu validasi ulang batch. Anda juga dapat memetakan kolom nama alih-alih kode.

**Apakah transaksi bisa dihapus?**  
Tidak. Gunakan koreksi/pembalik yang tercatat dan memerlukan persetujuan.

**Apakah data bisa diakses lintas bagian?**  
Hanya role dengan izin `stocks.view_all`/`dashboard.view_all`. Role lain dibatasi pada bagian yang ditugaskan, dan pembatasan diperiksa backend.
