import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, PackageCheck, Search, TriangleAlert } from 'lucide-react';
import { api } from '../lib/api';
import { formatDate, formatNumber } from '../lib/format';
import { useToast } from '../context/ToastContext';
import type { Department, Meta, Paginated, SimdondarReceipt } from '../types';
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Spinner,
  StatusBadge,
  Table,
  Tabs,
  Td,
  Textarea,
  Th,
} from '../components/ui';

interface ReceiptsResponse extends Paginated<SimdondarReceipt> {
  counts: Record<string, number>;
}

const TABS = [
  { key: 'AWAITING_RECEIPT', label: 'Menunggu diterima' },
  { key: 'RECEIVED', label: 'Diterima' },
  { key: 'RECEIVED_WITH_DISCREPANCY', label: 'Diterima (selisih)' },
  { key: 'DISPUTED', label: 'Disengketakan' },
  { key: 'ALL', label: 'Semua' },
];

export function ReceiptsPage() {
  const [params] = useSearchParams();
  const toast = useToast();
  const [tab, setTab] = useState(params.get('status') ?? 'AWAITING_RECEIPT');
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState(params.get('departmentId') ?? '');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ReceiptsResponse | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<SimdondarReceipt | null>(null);
  const [mode, setMode] = useState<'confirm' | 'dispute'>('confirm');
  const [qtyReceived, setQtyReceived] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    api.get<Meta>('/meta').then(setMeta).catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.get<ReceiptsResponse>('/receipts', {
        page,
        pageSize: 20,
        status: tab,
        search,
        departmentId: departmentId || undefined,
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat penerimaan.');
    } finally {
      setLoading(false);
    }
  }, [page, tab, search, departmentId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  const openConfirm = (item: SimdondarReceipt) => {
    setSelected(item);
    setMode('confirm');
    setQtyReceived(String(item.qty_received ?? item.qty_issued));
    setNote(item.received_note ?? '');
    setFormError('');
  };

  const openDispute = (item: SimdondarReceipt) => {
    setSelected(item);
    setMode('dispute');
    setQtyReceived('');
    setNote(item.received_note ?? '');
    setFormError('');
  };

  const submit = async () => {
    if (!selected) return;
    setFormError('');
    setSaving(true);
    try {
      if (mode === 'confirm') {
        const parsed = Number(qtyReceived);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          setFormError('Jumlah diterima harus lebih dari 0.');
          return;
        }
        await api.post(`/receipts/${selected.id}/confirm`, { qtyReceived: parsed, note: note || null });
        toast.success('Penerimaan berhasil dikonfirmasi dan saldo stok diperbarui.');
      } else {
        if (note.trim().length < 5) {
          setFormError('Alasan sengketa minimal 5 karakter.');
          return;
        }
        await api.post(`/receipts/${selected.id}/dispute`, { note });
        toast.success('Penerimaan ditandai sebagai sengketa.');
      }
      setSelected(null);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal memproses penerimaan.');
    } finally {
      setSaving(false);
    }
  };

  const departments: Department[] = meta?.departments ?? [];
  const counts = data?.counts ?? {};

  return (
    <>
      <PageHeader
        title="Penerimaan Barang"
        subtitle="Konfirmasi barang yang dikeluarkan SIMDONDAR ketika sudah diterima bagian. Saldo stok baru bertambah setelah dikonfirmasi."
      />

      <Card>
        <div className="border-b border-slate-100 px-3 pt-1">
          <Tabs
            tabs={TABS.map((item) => ({
              ...item,
              count: item.key === 'ALL' ? Object.values(counts).reduce((sum, value) => sum + Number(value), 0) : counts[item.key] ?? 0,
            }))}
            active={tab}
            onChange={(key) => { setTab(key); setPage(1); }}
          />
        </div>
        <div className="grid gap-2.5 border-b border-slate-100 p-3 sm:grid-cols-3">
          <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Cari no. dokumen, barang..." className="sm:col-span-2" />
          <Select value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setPage(1); }}>
            <option value="">Semua bagian</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>{department.name}</option>
            ))}
          </Select>
        </div>

        {error ? <div className="m-4 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{error}</div> : null}

        {loading && !data ? (
          <Spinner />
        ) : data && data.items.length ? (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Dokumen</Th>
                  <Th>Barang</Th>
                  <Th>Bagian</Th>
                  <Th align="right">Dikeluarkan</Th>
                  <Th align="right">Diterima</Th>
                  <Th>Status</Th>
                  <Th>Berkas impor</Th>
                  <Th align="right">Aksi</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/60">
                    <Td>
                      <p className="font-mono text-[11px] font-medium text-slate-700">{item.source_doc_number ?? `#${item.id}`}</p>
                      <p className="text-[11px] text-slate-500">{formatDate(item.source_date)}</p>
                    </Td>
                    <Td>
                      <p className="max-w-[220px] truncate text-sm font-medium text-slate-800">{item.item_name}</p>
                      <p className="text-[11px] text-slate-500">{item.item_code}</p>
                    </Td>
                    <Td className="text-xs">{item.department_name}</Td>
                    <Td align="right">
                      <span className="font-medium">{formatNumber(item.qty_issued)}</span>{' '}
                      <span className="text-[10px] text-slate-500">{item.unit_code}</span>
                    </Td>
                    <Td align="right">
                      {item.qty_received === null ? (
                        <span className="text-xs text-slate-400">-</span>
                      ) : (
                        <span className={Number(item.qty_received) !== Number(item.qty_issued) ? 'font-semibold text-amber-600' : 'font-medium text-emerald-700'}>
                          {formatNumber(item.qty_received)}
                        </span>
                      )}
                    </Td>
                    <Td><StatusBadge status={item.status} /></Td>
                    <Td>
                      <p className="max-w-[150px] truncate text-[11px] text-slate-500">{item.import_filename ?? '-'}</p>
                      {item.received_by_name ? <p className="text-[10px] text-slate-400">oleh {item.received_by_name}</p> : null}
                    </Td>
                    <Td align="right">
                      {['AWAITING_RECEIPT', 'DISPUTED'].includes(item.status) ? (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => openConfirm(item)}>
                            Terima
                          </Button>
                          {item.status === 'AWAITING_RECEIPT' ? (
                            <Button size="sm" variant="outline" onClick={() => openDispute(item)}>
                              Sengketa
                            </Button>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-400">Selesai</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} total={data.pagination.total} onChange={setPage} />
          </>
        ) : (
          <EmptyState
            title={tab === 'AWAITING_RECEIPT' ? 'Tidak ada penerimaan menunggu' : 'Belum ada data penerimaan'}
            description="Data berasal dari impor pengeluaran SIMDONDAR. Unggah berkas terlebih dahulu bila belum ada data."
          />
        )}
      </Card>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={mode === 'confirm' ? 'Konfirmasi Penerimaan' : 'Tandai Sengketa'}
        description={selected ? `${selected.item_name} · ${selected.department_name} · ${selected.source_doc_number ?? `#${selected.id}`}` : undefined}
        footer={
          <>
            <Button variant="outline" onClick={() => setSelected(null)}>Batal</Button>
            <Button loading={saving} variant={mode === 'confirm' ? 'primary' : 'danger'} onClick={() => void submit()}>
              {mode === 'confirm' ? 'Konfirmasi & Tambah Stok' : 'Tandai Sengketa'}
            </Button>
          </>
        }
      >
        {selected ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <div>
                <p className="text-[11px] text-slate-500">Jumlah dikeluarkan</p>
                <p className="font-semibold text-slate-800">{formatNumber(selected.qty_issued)} {selected.unit_code}</p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Tanggal dokumen</p>
                <p className="font-semibold text-slate-800">{formatDate(selected.source_date)}</p>
              </div>
            </div>
            {mode === 'confirm' ? (
              <>
                <Field label="Jumlah diterima" required hint="Ubah bila jumlah fisik yang diterima berbeda. Selisih akan tercatat dan status menjadi diterima dengan selisih.">
                  <Input type="number" min="0" step="any" value={qtyReceived} onChange={(event) => setQtyReceived(event.target.value)} />
                </Field>
                <Field label="Catatan penerimaan">
                  <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Opsional, misalnya kondisi barang atau nomor berita acara." />
                </Field>
              </>
            ) : (
              <Field label="Alasan sengketa" required hint="Jelaskan barang tidak sesuai, kurang, atau rusak. Saldo tidak bertambah.">
                <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Contoh: barang tidak diterima di bagian, jumlah tidak sesuai..." />
              </Field>
            )}
            {formError ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{formError}</div> : null}
            {mode === 'dispute' ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                Sengketa akan tercatat pada transaksi dan audit trail. Bila barang benar-benar diterima di kemudian hari, buka kembali dan konfirmasi.
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
