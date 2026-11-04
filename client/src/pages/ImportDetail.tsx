import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Loader2,
  SlidersHorizontal,
  UploadCloud,
} from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { formatDate, formatDateTime, formatNumber } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { ImportRow } from '../types';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  InfoBanner,
  PageHeader,
  Select,
  Spinner,
  StatusBadge,
  Table,
  Td,
  Textarea,
  Th,
} from '../components/ui';

interface BatchRecord {
  id: number;
  filename: string;
  file_type: string;
  status: string;
  total_rows: number;
  valid_rows: number;
  warning_rows: number;
  error_rows: number;
  duplicate_rows: number;
  imported_rows: number;
  receipt_mode: string;
  auto_create: number;
  mapping_json: string | null;
  notes: string | null;
  created_at: string;
  completed_at: string | null;
  created_by_name: string;
}

interface PreviewResponse {
  batch: BatchRecord;
  headers: string[];
  rows: ImportRow[];
}

const FIELDS = [
  { key: 'doc_number', label: 'Nomor Dokumen / Transaksi', required: false, hint: 'Kunci anti-duplikat utama.' },
  { key: 'line_number', label: 'Nomor Baris / Item', required: false, hint: 'Melengkapi kunci anti-duplikat.' },
  { key: 'date', label: 'Tanggal Pengeluaran', required: true, hint: 'Wajib.' },
  { key: 'item_code', label: 'Kode Barang', required: false, hint: 'Minimal salah satu kode/nama barang.' },
  { key: 'item_name', label: 'Nama Barang', required: false, hint: '' },
  { key: 'department_code', label: 'Kode Bagian Penerima', required: false, hint: 'Minimal salah satu kode/nama bagian.' },
  { key: 'department_name', label: 'Nama Bagian Penerima', required: false, hint: '' },
  { key: 'unit', label: 'Satuan', required: false, hint: 'Untuk konversi satuan bila tersedia.' },
  { key: 'qty_requested', label: 'Qty Diminta', required: false, hint: '' },
  { key: 'qty_approved', label: 'Qty Disetujui', required: false, hint: '' },
  { key: 'qty_issued', label: 'Qty Keluar', required: true, hint: 'Wajib.' },
  { key: 'notes', label: 'Keterangan', required: false, hint: '' },
] as const;

function parsedSummary(row: ImportRow): string {
  if (!row.parsed) return '-';
  return [
    row.parsed.date ? formatDate(row.parsed.date) : null,
    row.parsed.itemName,
    row.parsed.departmentName,
    row.parsed.qtyIssued !== undefined ? `${formatNumber(row.parsed.qtyIssued)} ${row.parsed.unitLabel ?? ''}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function ImportDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [validating, setValidating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [includeSuspects, setIncludeSuspects] = useState(false);
  const [autoCreate, setAutoCreate] = useState(false);
  const [notes, setNotes] = useState('');
  const [showMapping, setShowMapping] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.get<PreviewResponse>(`/imports/${id}`);
      setPreview(result);
      setShowMapping(result.batch.status === 'DRAFT');
      setAutoCreate(result.batch.auto_create === 1);
      try {
        setMapping(result.batch.mapping_json ? JSON.parse(result.batch.mapping_json) : {});
      } catch {
        setMapping({});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat batch impor.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const validate = async () => {
    setError('');
    for (const field of FIELDS.filter((item) => item.required)) {
      if (!mapping[field.key]) {
        setError(`Kolom "${field.label}" wajib dipetakan.`);
        return;
      }
    }
    if (!mapping.item_code && !mapping.item_name) {
      setError('Petakan minimal salah satu: Kode Barang atau Nama Barang.');
      return;
    }
    if (!mapping.department_code && !mapping.department_name) {
      setError('Petakan minimal salah satu: Kode Bagian atau Nama Bagian Penerima.');
      return;
    }
    setValidating(true);
    try {
      const result = await api.post<{ total: number; counts: { valid: number; warning: number; error: number; duplicate: number }; createdItems: number; createdDepartments: number }>(
        `/imports/${id}/validate`,
        { mapping, autoCreate },
      );
      let message = `Validasi selesai: ${result.counts.valid} valid, ${result.counts.warning} peringatan, ${result.counts.error} gagal, ${result.counts.duplicate} duplikat.`;
      if (result.createdItems > 0 || result.createdDepartments > 0) {
        message += ` Barang dan bagian baru dibuat otomatis: ${result.createdItems} barang, ${result.createdDepartments} bagian.`;
      }
      toast.success(message);
      await load();
      setShowMapping(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memvalidasi batch.');
    } finally {
      setValidating(false);
    }
  };

  const commit = async () => {
    setError('');
    setCommitting(true);
    try {
      const result = await api.post<{ imported: number; skipped: number; failed: number; awaitingReceipt: number }>(`/imports/${id}/commit`, {
        includeSuspects,
        notes: notes || null,
      });
      toast.success(`Commit selesai: ${result.imported} transaksi dibuat, ${result.skipped} dilewati, ${result.failed} gagal.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal commit batch.');
    } finally {
      setCommitting(false);
    }
  };

  const batch = preview?.batch;
  const rows = preview?.rows ?? [];
  const headers = preview?.headers ?? [];

  const counts = useMemo(
    () => ({
      valid: batch?.valid_rows ?? 0,
      warning: batch?.warning_rows ?? 0,
      error: batch?.error_rows ?? 0,
      duplicate: batch?.duplicate_rows ?? 0,
    }),
    [batch],
  );

  if (loading) return <Spinner />;
  if (!batch || !preview) {
    return (
      <>
        <PageHeader title="Detail Impor" />
        <Card><EmptyState title="Batch tidak ditemukan" description={error} action={<Link to="/impor"><Button variant="outline">Kembali</Button></Link>} /></Card>
      </>
    );
  }

  const isDraft = batch.status === 'DRAFT';
  const isValidated = batch.status === 'VALIDATED';
  const isCommitted = batch.status === 'COMMITTED';
  const canManage = can('imports.manage');
  const canAutoCreateMasters = can('items.manage') || can('departments.manage');

  return (
    <>
      <PageHeader
        title="Detail Impor"
        subtitle={`${batch.filename} · ${formatNumber(batch.total_rows)} baris · diunggah ${formatDateTime(batch.created_at)} oleh ${batch.created_by_name}`}
        actions={
          <>
            <Link to="/impor"><Button variant="outline" size="sm" icon={<ArrowLeft className="h-4 w-4" />}>Riwayat</Button></Link>
            <StatusBadge status={batch.status} />
          </>
        }
      />

      <div className="mb-5 grid gap-2 sm:grid-cols-4">
        {[
          { key: 'mapping', label: '1. Pemetaan', done: !isDraft, active: isDraft || showMapping },
          { key: 'validate', label: '2. Validasi', done: isCommitted, active: isValidated },
          { key: 'review', label: '3. Tinjau', done: isCommitted, active: isValidated },
          { key: 'commit', label: '4. Commit', done: isCommitted, active: isCommitted },
        ].map((step) => (
          <div
            key={step.key}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs ${
              step.done ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : step.active ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-slate-200 bg-white text-slate-500'
            }`}
          >
            {step.done ? <CheckCircle2 className="h-4 w-4" /> : step.active ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
            <span className="font-medium">{step.label}</span>
          </div>
        ))}
      </div>

      {error ? <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{error}</div> : null}

      {isCommitted ? (
        <div className="mb-5">
          <InfoBanner tone="success" title="Batch telah di-commit">
            {formatNumber(batch.imported_rows)} baris menjadi transaksi SIMDONDAR. Penerimaan{' '}
            {batch.receipt_mode === 'auto' ? 'langsung menambah saldo (mode otomatis)' : 'menunggu konfirmasi bagian (mode konfirmasi)'}.
            {batch.completed_at ? ` Selesai ${formatDateTime(batch.completed_at)}.` : ''}
          </InfoBanner>
        </div>
      ) : null}

      {(isDraft || showMapping) && canManage ? (
        <Card className="mb-5">
          <CardHeader
            title={<span className="inline-flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-slate-400" /> Pemetaan Kolom</span>}
            subtitle="Pasangkan kolom berkas dengan field sistem. Kolom bertanda wajib harus dipetakan sebelum validasi."
            action={
              isValidated ? (
                <Button variant="outline" size="sm" onClick={() => setShowMapping(false)}>Tutup pemetaan</Button>
              ) : null
            }
          />
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {FIELDS.map((field) => (
              <Field key={field.key} label={field.label} required={field.required} hint={field.hint || undefined}>
                <Select value={mapping[field.key] ?? ''} onChange={(event) => setMapping((current) => ({ ...current, [field.key]: event.target.value }))}>
                  <option value="">— Tidak dipetakan —</option>
                  {headers.map((header) => (
                    <option key={header} value={header}>{header}</option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3">
            {canAutoCreateMasters ? (
              <label className="flex items-start gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={autoCreate} onChange={(event) => setAutoCreate(event.target.checked)} className="mt-0.5" />
                <span>
                  Buat otomatis barang &amp; bagian yang belum ada di master
                  <span className="block text-[11px] text-slate-400">
                    Barang baru memakai satuan dari kolom Satuan, atau PCS bila kosong/tidak dikenal. Kode dibuat otomatis bila kolom kode kosong.
                  </span>
                </span>
              </label>
            ) : (
              <p className="text-xs text-slate-500">
                Contoh data di bawah membantu memastikan pemetaan benar sebelum validasi.
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void downloadFile(`/imports/template.xlsx`, undefined, 'template-import-simdondar.xlsx')} icon={<Download className="h-4 w-4" />}>
                Template
              </Button>
              <Button size="sm" loading={validating} onClick={() => void validate()} icon={<CheckCircle2 className="h-4 w-4" />}>
                Validasi Data
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {isValidated && canManage && !showMapping ? (
        <Card className="mb-5">
          <CardHeader title="Commit Batch" subtitle="Baris valid dan peringatan akan dibuat sebagai transaksi. Baris gagal dilewati." />
          <div className="space-y-4 p-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-[11px] uppercase tracking-wide text-emerald-700">Valid</p>
                <p className="mt-1 text-xl font-semibold text-emerald-800">{formatNumber(counts.valid)}</p>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-[11px] uppercase tracking-wide text-amber-700">Peringatan</p>
                <p className="mt-1 text-xl font-semibold text-amber-800">{formatNumber(counts.warning)}</p>
              </div>
              <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
                <p className="text-[11px] uppercase tracking-wide text-violet-700">Duplikat</p>
                <p className="mt-1 text-xl font-semibold text-violet-800">{formatNumber(counts.duplicate)}</p>
              </div>
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                <p className="text-[11px] uppercase tracking-wide text-rose-700">Gagal</p>
                <p className="mt-1 text-xl font-semibold text-rose-800">{formatNumber(counts.error)}</p>
              </div>
            </div>

            {counts.duplicate > 0 ? (
              <div className="rounded-lg border border-violet-200 bg-violet-50 px-3.5 py-3 text-xs leading-5 text-violet-800">
                <p className="font-semibold">Terdapat {counts.duplicate} baris duplikat.</p>
                <p className="mt-0.5">
                  Duplikat berdasarkan nomor dokumen selalu dilewati. Duplikat berdasarkan kemiripan isi dapat dipaksa masuk
                  hanya bila Anda yakin baris tersebut bukan duplikat.
                </p>
                <label className="mt-2 flex items-center gap-2 font-medium">
                  <input type="checkbox" checked={includeSuspects} onChange={(event) => setIncludeSuspects(event.target.checked)} />
                  Sertakan duplikat berbasis kemiripan isi (fingerprint) sebagai transaksi baru
                </label>
              </div>
            ) : null}

            <Field label="Catatan commit" hint="Opsional, tersimpan pada batch dan audit trail.">
              <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Misalnya: impor pengeluaran periode Oktober 2026." />
            </Field>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowMapping(true)} icon={<SlidersHorizontal className="h-4 w-4" />}>Ubah pemetaan</Button>
                <Button variant="outline" size="sm" onClick={() => void downloadFile(`/imports/${batch.id}/errors.xlsx`, undefined, `hasil-impor-${batch.id}.xlsx`)} icon={<Download className="h-4 w-4" />}>
                  Unduh hasil validasi
                </Button>
              </div>
              <Button loading={committing} onClick={() => void commit()} icon={<UploadCloud className="h-4 w-4" />}>
                Commit {formatNumber(counts.valid + counts.warning)} Baris
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {isDraft ? (
        <Card className="mb-5">
          <CardHeader title="Pratinjau Berkas" subtitle={`${headers.length} kolom · ${rows.length} baris ditampilkan`} />
          <Table>
            <thead>
              <tr>
                <Th>Baris</Th>
                {headers.slice(0, 8).map((header) => <Th key={header}>{header}</Th>)}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 8).map((row) => (
                <tr key={row.rowNumber}>
                  <Td className="text-xs text-slate-400">{row.rowNumber}</Td>
                  {headers.slice(0, 8).map((header) => (
                    <Td key={header} className="max-w-[180px] truncate text-xs">{String(row.raw[header] ?? '')}</Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : (
        <Card>
          <CardHeader
            title={<span className="inline-flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-slate-400" /> Hasil Validasi</span>}
            subtitle={`${rows.length} baris ditampilkan dari ${batch.total_rows}. Baris gagal dapat diunduh sebagai Excel.`}
            action={
              <Button variant="outline" size="sm" onClick={() => void downloadFile(`/imports/${batch.id}/errors.xlsx`, undefined, `hasil-impor-${batch.id}.xlsx`)} icon={<Download className="h-4 w-4" />}>
                Unduh hasil
              </Button>
            }
          />
          {rows.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Baris</Th>
                  <Th>Status</Th>
                  <Th>Data terbaca</Th>
                  <Th>Catatan validasi</Th>
                  <Th>Identitas</Th>
                  <Th align="right">Transaksi</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.rowNumber} className={row.status === 'ERROR' ? 'bg-rose-50/30' : row.status === 'DUPLICATE' ? 'bg-violet-50/30' : undefined}>
                    <Td className="text-xs text-slate-500">{row.rowNumber}</Td>
                    <Td><StatusBadge status={row.status} /></Td>
                    <Td>
                      <p className="max-w-[300px] truncate text-xs text-slate-700">{parsedSummary(row)}</p>
                      <p className="text-[10px] text-slate-400">No. dok: {row.parsed?.docNumber ?? '-'} · baris: {row.parsed?.lineNumber ?? '-'}</p>
                    </Td>
                    <Td>
                      {row.errors.map((message) => (
                        <p key={message} className="flex items-start gap-1 text-[11px] text-rose-600">
                          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> {message}
                        </p>
                      ))}
                      {row.warnings.map((message) => (
                        <p key={message} className="flex items-start gap-1 text-[11px] text-amber-600">
                          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> {message}
                        </p>
                      ))}
                      {!row.errors.length && !row.warnings.length ? <span className="text-[11px] text-slate-400">Tidak ada catatan</span> : null}
                    </Td>
                    <Td><span className="max-w-[180px] truncate font-mono text-[10px] text-slate-500">{row.identity ?? '-'}</span></Td>
                    <Td align="right" className="text-xs">
                      {row.transactionId ? <Badge tone="green">#{row.transactionId}</Badge> : <span className="text-slate-400">-</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState title="Belum ada hasil" description="Validasi batch untuk melihat hasil per baris." />
          )}
        </Card>
      )}

      {isCommitted && batch.receipt_mode === 'confirm' ? (
        <div className="mt-4">
          <InfoBanner tone="info" title="Langkah berikutnya">
            Transaksi hasil impor berstatus menunggu diterima. Buka <Link to="/penerimaan" className="font-semibold underline">Penerimaan</Link> untuk
            mengonfirmasi barang yang sudah diterima bagian. Saldo stok baru bertambah setelah konfirmasi.
          </InfoBanner>
        </div>
      ) : null}
    </>
  );
}
