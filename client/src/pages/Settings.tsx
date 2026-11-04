import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Database,
  Download,
  HardDriveDownload,
  RefreshCw,
  Save,
  Settings as SettingsIcon,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { formatDateTime, formatNumber } from '../lib/format';
import { useToast } from '../context/ToastContext';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  InfoBanner,
  Input,
  PageHeader,
  Select,
  Spinner,
  Table,
  Td,
  Th,
} from '../components/ui';

interface SettingRow {
  key: string;
  value: string;
  updated_at: string | null;
}

interface Backup {
  filename: string;
  size: number;
  createdAt: string;
}

interface IntegrityRow {
  departmentId: number;
  departmentName: string;
  itemId: number;
  itemCode: string;
  itemName: string;
  cachedQty: number;
  ledgerQty: number;
  difference: number;
}

export function SettingsPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    app_name: '',
    organization_name: '',
    receipt_mode: 'confirm',
    adjustment_approval_threshold: '0',
    late_input_days: '7',
    opname_period: 'bulanan',
  });
  const [backups, setBackups] = useState<Backup[]>([]);
  const [backupBusy, setBackupBusy] = useState(false);
  const [integrity, setIntegrity] = useState<IntegrityRow[] | null>(null);
  const [integrityBusy, setIntegrityBusy] = useState(false);
  const [recalcConfirm, setRecalcConfirm] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.get<{ items: SettingRow[] }>('/settings');
      const map = Object.fromEntries(result.items.map((row) => [row.key, row.value]));
      setForm({
        app_name: map.app_name ?? '',
        organization_name: map.organization_name ?? '',
        receipt_mode: map.receipt_mode ?? 'confirm',
        adjustment_approval_threshold: map.adjustment_approval_threshold ?? '0',
        late_input_days: map.late_input_days ?? '7',
        opname_period: map.opname_period ?? 'bulanan',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat pengaturan.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadBackups = useCallback(async () => {
    try {
      const result = await api.get<{ items: Backup[] }>('/system/backups');
      setBackups(result.items);
    } catch {
      /* abaikan */
    }
  }, []);

  useEffect(() => {
    void loadSettings();
    void loadBackups();
  }, [loadSettings, loadBackups]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/settings', {
        app_name: form.app_name,
        organization_name: form.organization_name,
        receipt_mode: form.receipt_mode,
        adjustment_approval_threshold: Number(form.adjustment_approval_threshold || 0),
        late_input_days: Number(form.late_input_days || 7),
        opname_period: form.opname_period,
      });
      toast.success('Pengaturan berhasil disimpan.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan pengaturan.');
    } finally {
      setSaving(false);
    }
  };

  const createBackup = async () => {
    setBackupBusy(true);
    try {
      const result = await api.post<{ filename: string; message: string }>('/system/backup');
      toast.success(`Backup dibuat: ${result.filename}`);
      await loadBackups();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal membuat backup.');
    } finally {
      setBackupBusy(false);
    }
  };

  const checkIntegrity = async () => {
    setIntegrityBusy(true);
    try {
      const result = await api.get<{ items: IntegrityRow[] }>('/stocks/integrity');
      setIntegrity(result.items);
      if (result.items.length) toast.error(`Ditemukan ${result.items.length} selisih saldo.`);
      else toast.success('Saldo cache konsisten dengan ledger.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memeriksa integritas.');
    } finally {
      setIntegrityBusy(false);
    }
  };

  const recalculate = async () => {
    setIntegrityBusy(true);
    try {
      const result = await api.post<{ message: string; items: IntegrityRow[] }>('/stocks/integrity/recalculate');
      setIntegrity(result.items);
      setRecalcConfirm(false);
      toast.success(result.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghitung ulang saldo.');
    } finally {
      setIntegrityBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Pengaturan Sistem"
        subtitle="Konfigurasi identitas aplikasi, mode penerimaan, ambang operasional, backup database, dan pemeriksaan integritas saldo."
      />

      {error ? <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{error}</div> : null}

      {loading ? (
        <Card><Spinner /></Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card>
            <CardHeader
              title={<span className="inline-flex items-center gap-2"><SettingsIcon className="h-4 w-4 text-slate-400" /> Identitas & Operasional</span>}
              subtitle="Perubahan disimpan pada tabel settings dan dicatat pada audit trail."
              action={<Button size="sm" loading={saving} onClick={() => void save()} icon={<Save className="h-4 w-4" />}>Simpan</Button>}
            />
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <Field label="Nama aplikasi" required className="sm:col-span-2">
                <Input value={form.app_name} onChange={(event) => setForm({ ...form, app_name: event.target.value })} />
              </Field>
              <Field label="Nama organisasi" required className="sm:col-span-2">
                <Input value={form.organization_name} onChange={(event) => setForm({ ...form, organization_name: event.target.value })} />
              </Field>
              <Field label="Mode penerimaan" hint="Konfirmasi: saldo bertambah setelah bagian menerima. Otomatis: langsung bertambah saat commit impor.">
                <Select value={form.receipt_mode} onChange={(event) => setForm({ ...form, receipt_mode: event.target.value })}>
                  <option value="confirm">Konfirmasi manual (disarankan)</option>
                  <option value="auto">Otomatis</option>
                </Select>
              </Field>
              <Field label="Ambang persetujuan penyesuaian" hint="Nilai 0 berarti semua penyesuaian memerlukan persetujuan.">
                <Input type="number" min="0" step="any" value={form.adjustment_approval_threshold} onChange={(event) => setForm({ ...form, adjustment_approval_threshold: event.target.value })} />
              </Field>
              <Field label="Ambang keterlambatan input (hari)">
                <Input type="number" min="1" max="90" value={form.late_input_days} onChange={(event) => setForm({ ...form, late_input_days: event.target.value })} />
              </Field>
              <Field label="Periode opname">
                <Select value={form.opname_period} onChange={(event) => setForm({ ...form, opname_period: event.target.value })}>
                  <option value="bulanan">Bulanan</option>
                  <option value="triwulan">Triwulan</option>
                  <option value="semester">Semester</option>
                  <option value="tahunan">Tahunan</option>
                </Select>
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader
              title={<span className="inline-flex items-center gap-2"><Database className="h-4 w-4 text-slate-400" /> Backup Database</span>}
              subtitle="Backup dibuat dengan VACUUM INTO pada SQLite. Unduh dan simpan di lokasi aman."
              action={<Button size="sm" loading={backupBusy} onClick={() => void createBackup()} icon={<HardDriveDownload className="h-4 w-4" />}>Buat Backup</Button>}
            />
            <div className="p-4">
              <div className="mb-3">
                <InfoBanner tone="info" title="Pemulihan">
                  Untuk memulihkan, hentikan server lalu ganti berkas <code>data/stok.db</code> dengan berkas backup pilihan.
                  Prosedur lengkap tersedia pada dokumentasi <code>docs/BACKUP_RESTORE.md</code>.
                </InfoBanner>
              </div>
              {backups.length ? (
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <Table>
                    <thead><tr><Th>Berkas</Th><Th align="right">Ukuran</Th><Th>Dibuat</Th><Th align="right">Aksi</Th></tr></thead>
                    <tbody>
                      {backups.slice(0, 8).map((backup) => (
                        <tr key={backup.filename}>
                          <Td><span className="max-w-[200px] truncate font-mono text-[10px] text-slate-600">{backup.filename}</span></Td>
                          <Td align="right" className="text-xs">{(backup.size / 1024 / 1024).toFixed(2)} MB</Td>
                          <Td className="text-[11px] text-slate-500">{formatDateTime(backup.createdAt)}</Td>
                          <Td align="right">
                            <Button size="sm" variant="outline" onClick={() => void downloadFile(`/system/backups/${backup.filename}`, undefined, backup.filename)} icon={<Download className="h-3.5 w-3.5" />}>Unduh</Button>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              ) : (
                <EmptyState compact title="Belum ada backup" description="Buat backup pertama untuk mengamankan data." />
              )}
            </div>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader
              title={<span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-slate-400" /> Integritas Saldo</span>}
              subtitle="Bandingkan cache saldo (department_stock_balances) dengan hasil penjumlahan ledger. Selisih menunjukkan ketidaksesuaian yang perlu ditinjau."
              action={
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" loading={integrityBusy} onClick={() => void checkIntegrity()} icon={<RefreshCw className="h-4 w-4" />}>Periksa</Button>
                  <Button size="sm" variant="danger" loading={integrityBusy} onClick={() => setRecalcConfirm(true)}>Hitung Ulang</Button>
                </div>
              }
            />
            <div className="p-4">
              {integrity === null ? (
                <p className="text-xs text-slate-500">Klik "Periksa" untuk membandingkan saldo cache dengan ledger.</p>
              ) : integrity.length ? (
                <div className="overflow-hidden rounded-lg border border-rose-200">
                  <Table>
                    <thead><tr><Th>Bagian</Th><Th>Barang</Th><Th align="right">Saldo cache</Th><Th align="right">Saldo ledger</Th><Th align="right">Selisih</Th></tr></thead>
                    <tbody>
                      {integrity.map((row) => (
                        <tr key={`${row.departmentId}-${row.itemId}`} className="bg-rose-50/30">
                          <Td className="text-xs">{row.departmentName}</Td>
                          <Td><p className="text-xs font-medium">{row.itemName}</p><p className="text-[10px] text-slate-500">{row.itemCode}</p></Td>
                          <Td align="right" className="text-xs">{formatNumber(row.cachedQty)}</Td>
                          <Td align="right" className="text-xs">{formatNumber(row.ledgerQty)}</Td>
                          <Td align="right" className="text-xs font-semibold text-rose-600">{formatNumber(row.difference)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800">
                  <CheckCircle2 className="h-4 w-4" /> Seluruh saldo cache konsisten dengan ledger.
                </div>
              )}
              {recalcConfirm ? (
                <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
                  <div className="flex items-start gap-2 text-xs text-rose-800">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-semibold">Hitung ulang seluruh saldo?</p>
                      <p className="mt-0.5">Cache saldo akan dihapus dan dibangun kembali dari ledger. Tindakan ini dicatat pada audit trail.</p>
                    </div>
                  </div>
                  <div className="mt-2 flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setRecalcConfirm(false)}>Batal</Button>
                    <Button size="sm" variant="danger" loading={integrityBusy} onClick={() => void recalculate()}>Ya, Hitung Ulang</Button>
                  </div>
                </div>
              ) : null}
            </div>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader title="Catatan Keamanan" subtitle="Pastikan konfigurasi produksi berikut terpenuhi." />
            <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                'Kata sandi admin awal wajib diganti sebelum digunakan.',
                'Jalankan aplikasi di balik HTTPS (reverse proxy).',
                'Batasi akses folder data dan backup hanya untuk operator.',
                'Jadwalkan backup otomatis harian dan uji pemulihan.',
              ].map((text) => (
                <div key={text} className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-xs leading-5 text-slate-600">
                  <Badge tone="teal">Wajib</Badge>
                  <span>{text}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
