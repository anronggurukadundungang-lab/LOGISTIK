import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download, FileSpreadsheet, RefreshCw, Upload } from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { formatDateTime, formatNumber } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { ImportBatch, Paginated } from '../types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  InfoBanner,
  PageHeader,
  Pagination,
  Spinner,
  StatusBadge,
  Table,
  Td,
  Th,
} from '../components/ui';

export function ImportsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<ImportBatch> | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.get<Paginated<ImportBatch>>('/imports', { page, pageSize: 20 });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat riwayat impor.');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (file: File) => {
    if (!/\.(xlsx|csv|pdf)$/i.test(file.name)) {
      toast.error('Format file harus .xlsx, .csv, atau .pdf.');
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const result = await api.upload<{ batchId: number; totalRows: number }>('/imports/upload', form);
      toast.success(`Berkas ${file.name} diunggah (${result.totalRows} baris). Lanjutkan pemetaan kolom.`);
      navigate(`/impor/${result.batchId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengunggah berkas.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <>
      <PageHeader
        title="Impor SIMDONDAR"
        subtitle="Unggah PDF, Excel, atau CSV pengeluaran barang dari SIMDONDAR, petakan kolom, validasi, lalu commit. Kolom harga dan total pada PDF diabaikan; data ganda dicegah berdasarkan nomor dokumen dan baris."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => void downloadFile('/imports/template.xlsx', undefined, 'template-import-simdondar.xlsx')}
              icon={<Download className="h-4 w-4" />}
            >
              Template
            </Button>
            <Button variant="outline" onClick={() => void load()} loading={loading} icon={<RefreshCw className="h-4 w-4" />}>Muat ulang</Button>
            {can('imports.manage') ? (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.csv,.pdf"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void upload(file);
                  }}
                />
                <Button loading={uploading} onClick={() => fileRef.current?.click()} icon={<Upload className="h-4 w-4" />}>
                  Unggah Berkas
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="mb-5">
        <InfoBanner tone="info" title="Alur impor">
          Unggah berkas → petakan kolom → validasi (baris valid, peringatan, gagal, duplikat) → periksa hasil → commit.
          Commit tidak dapat dibatalkan; baris gagal dapat diunduh sebagai laporan Excel untuk diperbaiki.
        </InfoBanner>
      </div>

      <Card>
        {error ? <div className="m-4 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{error}</div> : null}
        {loading && !data ? (
          <Spinner />
        ) : data && data.items.length ? (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Berkas</Th>
                  <Th>Status</Th>
                  <Th align="right">Total baris</Th>
                  <Th align="right">Valid</Th>
                  <Th align="right">Peringatan</Th>
                  <Th align="right">Gagal</Th>
                  <Th align="right">Duplikat</Th>
                  <Th align="right">Terimpor</Th>
                  <Th>Diunggah</Th>
                  <Th align="right">Aksi</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((batch) => (
                  <tr key={batch.id} className="hover:bg-slate-50/60">
                    <Td>
                      <Link to={`/impor/${batch.id}`} className="flex items-center gap-2 text-sm font-medium text-brand-700 hover:underline">
                        <FileSpreadsheet className="h-4 w-4 shrink-0" />
                        <span className="max-w-[240px] truncate">{batch.filename}</span>
                      </Link>
                      <p className="text-[11px] text-slate-500">{batch.file_type.toUpperCase()} · {batch.receipt_mode === 'auto' ? 'penerimaan otomatis' : 'konfirmasi manual'}</p>
                    </Td>
                    <Td><StatusBadge status={batch.status} /></Td>
                    <Td align="right" className="text-xs">{formatNumber(batch.total_rows)}</Td>
                    <Td align="right" className="text-xs font-medium text-emerald-700">{formatNumber(batch.valid_rows)}</Td>
                    <Td align="right" className="text-xs text-amber-600">{formatNumber(batch.warning_rows)}</Td>
                    <Td align="right" className="text-xs text-rose-600">{formatNumber(batch.error_rows)}</Td>
                    <Td align="right" className="text-xs text-violet-600">{formatNumber(batch.duplicate_rows)}</Td>
                    <Td align="right" className="text-xs font-medium">{formatNumber(batch.imported_rows)}</Td>
                    <Td>
                      <p className="text-[11px] text-slate-600">{batch.created_by_name}</p>
                      <p className="text-[10px] text-slate-400">{formatDateTime(batch.created_at)}</p>
                    </Td>
                    <Td align="right">
                      <Link to={`/impor/${batch.id}`}>
                        <Button size="sm" variant="outline">{batch.status === 'DRAFT' || batch.status === 'VALIDATED' ? 'Lanjutkan' : 'Detail'}</Button>
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} total={data.pagination.total} onChange={setPage} />
          </>
        ) : (
          <EmptyState
            title="Belum ada riwayat impor"
            description="Unggah PDF, Excel, atau CSV pengeluaran SIMDONDAR untuk memulai. Kolom harga PDF tidak disertakan. Gunakan template Excel agar pemetaan kolom lebih mudah."
          />
        )}
      </Card>

      <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
        <Badge tone="gray">Anti-duplikat: nomor dokumen + baris</Badge>
        <Badge tone="gray">Fingerprint isi sebagai cadangan</Badge>
        <Badge tone="gray">Pratinjau sebelum commit</Badge>
      </div>
    </>
  );
}
