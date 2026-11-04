import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ClipboardCheck, Save, Send, TriangleAlert } from 'lucide-react';
import { api } from '../lib/api';
import { formatDate, formatNumber, statusLabel } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  InfoBanner,
  Input,
  Modal,
  PageHeader,
  Spinner,
  StatusBadge,
  Table,
  Td,
  Th,
} from '../components/ui';

interface OpnameDetailRow {
  id: number;
  session_id: number;
  item_id: number;
  item_code: string;
  item_name: string;
  unit_code: string;
  system_qty: number;
  physical_qty: number | null;
  difference: number | null;
  reason: string | null;
  current_qty: number;
  adjustment_entry_no: string | null;
}

interface OpnameSessionDetail {
  id: number;
  department_id: number;
  period: string;
  opname_date: string;
  status: string;
  notes: string | null;
  department_name: string;
  created_by_name: string;
  decided_by_name: string | null;
  decision_note: string | null;
  approval_id: number | null;
}

interface ApprovalInfo {
  id: number;
  status: string;
  decision_note: string | null;
}

export function OpnameDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const [session, setSession] = useState<OpnameSessionDetail | null>(null);
  const [details, setDetails] = useState<OpnameDetailRow[]>([]);
  const [approval, setApproval] = useState<ApprovalInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [physical, setPhysical] = useState<Record<number, string>>({});
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.get<{
        item: OpnameSessionDetail;
        details: OpnameDetailRow[];
        approval: ApprovalInfo | null;
      }>(`/opnames/${id}`);
      setSession(result.item);
      setDetails(result.details);
      setApproval(result.approval);
      setPhysical(
        Object.fromEntries(
          result.details.map((row) => [row.id, row.physical_qty === null ? '' : String(row.physical_qty)]),
        ),
      );
      setReasons(Object.fromEntries(result.details.map((row) => [row.id, row.reason ?? ''])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat sesi opname.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () =>
      details.filter(
        (row) =>
          !search ||
          row.item_name.toLowerCase().includes(search.toLowerCase()) ||
          row.item_code.toLowerCase().includes(search.toLowerCase()),
      ),
    [details, search],
  );

  const stats = useMemo(() => {
    const filled = details.filter((row) => physical[row.id] !== '' && physical[row.id] !== undefined).length;
    const diffRows = details.filter((row) => {
      if (physical[row.id] === '' || physical[row.id] === undefined) return false;
      return Math.abs(Number(physical[row.id]) - Number(row.system_qty)) > 1e-9;
    });
    const diffQty = diffRows.reduce((sum, row) => sum + Math.abs(Number(physical[row.id]) - Number(row.system_qty)), 0);
    return { filled, unfilled: details.length - filled, diffRows: diffRows.length, diffQty };
  }, [details, physical]);

  const saveRow = async (row: OpnameDetailRow) => {
    const value = physical[row.id];
    if (value === '' || value === undefined) {
      toast.error('Isi jumlah fisik terlebih dahulu.');
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error('Jumlah fisik tidak boleh negatif.');
      return;
    }
    setSavingId(row.id);
    try {
      await api.patch(`/opnames/${id}/details/${row.id}`, {
        physicalQty: parsed,
        reason: reasons[row.id] || null,
      });
      setDetails((current) =>
        current.map((item) =>
          item.id === row.id
            ? { ...item, physical_qty: parsed, difference: parsed - Number(item.system_qty), reason: reasons[row.id] || null }
            : item,
        ),
      );
      toast.success(`Jumlah fisik ${row.item_name} tersimpan.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan jumlah fisik.');
    } finally {
      setSavingId(null);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      await api.post(`/opnames/${id}/submit`);
      toast.success('Hasil opname diajukan untuk persetujuan.');
      setSubmitOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengajukan opname.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Spinner />;
  if (!session) {
    return (
      <>
        <PageHeader title="Stok Opname" />
        <Card><EmptyState title="Sesi tidak ditemukan" description={error} action={<Link to="/opname"><Button variant="outline">Kembali</Button></Link>} /></Card>
      </>
    );
  }

  const editable = session.status === 'DRAFT' && can('opnames.create');

  return (
    <>
      <PageHeader
        title="Detail Stok Opname"
        subtitle={`${session.department_name} · periode ${session.period} · ${formatDate(session.opname_date)}`}
        actions={
          <>
            <Link to="/opname"><Button variant="outline" size="sm" icon={<ArrowLeft className="h-4 w-4" />}>Kembali</Button></Link>
            {editable ? (
              <Button size="sm" icon={<Send className="h-4 w-4" />} onClick={() => setSubmitOpen(true)} disabled={stats.unfilled > 0}>
                Ajukan Opname
              </Button>
            ) : null}
          </>
        }
      />

      {error ? <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{error}</div> : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Status</p>
          <div className="mt-2"><StatusBadge status={session.status} /></div>
          <p className="mt-2 text-[11px] text-slate-500">Dibuat oleh {session.created_by_name}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Item dihitung</p>
          <p className="mt-1.5 text-2xl font-semibold text-slate-900">{formatNumber(stats.filled)} <span className="text-sm font-normal text-slate-500">/ {formatNumber(details.length)}</span></p>
          <p className="mt-1 text-[11px] text-slate-500">{stats.unfilled} belum diisi</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Item selisih</p>
          <p className="mt-1.5 text-2xl font-semibold text-amber-600">{formatNumber(stats.diffRows)}</p>
          <p className="mt-1 text-[11px] text-slate-500">Baris dengan fisik berbeda dari sistem</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Total qty selisih</p>
          <p className="mt-1.5 text-2xl font-semibold text-slate-900">{formatNumber(stats.diffQty)}</p>
          <p className="mt-1 text-[11px] text-slate-500">Nilai absolut seluruh selisih</p>
        </Card>
      </div>

      {session.status === 'SUBMITTED' ? (
        <div className="mb-5">
          <InfoBanner tone="warning" title="Menunggu persetujuan">
            Hasil opname telah diajukan. Saldo belum berubah. Setelah disetujui, selisih akan dibukukan sebagai penyesuaian.
          </InfoBanner>
        </div>
      ) : session.status === 'APPROVED' ? (
        <div className="mb-5">
          <InfoBanner tone="success" title={`Disetujui${session.decided_by_name ? ` oleh ${session.decided_by_name}` : ''}`}>
            Selisih opname telah dibukukan ke ledger sebagai transaksi penyesuaian. {session.decision_note}
          </InfoBanner>
        </div>
      ) : session.status === 'REJECTED' ? (
        <div className="mb-5">
          <InfoBanner tone="danger" title={`Ditolak${session.decided_by_name ? ` oleh ${session.decided_by_name}` : ''}`}>
            {session.decision_note ?? 'Opname ditolak. Saldo tidak berubah.'}
          </InfoBanner>
        </div>
      ) : null}

      {session.notes ? (
        <div className="mb-5">
          <InfoBanner tone="info" title="Catatan sesi">{session.notes}</InfoBanner>
        </div>
      ) : null}

      <Card>
        <CardHeader
          title={<span className="inline-flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-slate-400" /> Lembar Hitung Fisik</span>}
          subtitle={editable ? 'Masukkan jumlah fisik nyata. Tekan simpan per baris. Alasan wajib diisi untuk baris yang selisih.' : 'Sesi ini tidak dapat diubah lagi.'}
          action={<Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari barang..." className="h-9 w-56" />}
        />
        {filtered.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Barang</Th>
                <Th align="right">Saldo Sistem</Th>
                <Th align="right">Fisik</Th>
                <Th align="right">Selisih</Th>
                <Th>Alasan selisih</Th>
                {editable ? <Th align="right">Aksi</Th> : null}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const value = physical[row.id] ?? '';
                const hasValue = value !== '';
                const difference = hasValue ? Number(value) - Number(row.system_qty) : row.difference;
                const hasDiff = difference !== null && Math.abs(Number(difference)) > 1e-9;
                return (
                  <tr key={row.id} className={hasDiff ? 'bg-amber-50/30' : undefined}>
                    <Td>
                      <p className="max-w-[240px] truncate text-sm font-medium text-slate-800">{row.item_name}</p>
                      <p className="text-[11px] text-slate-500">{row.item_code} · {row.unit_code}</p>
                      {row.adjustment_entry_no ? <p className="text-[10px] text-emerald-600">Penyesuaian {row.adjustment_entry_no}</p> : null}
                    </Td>
                    <Td align="right" className="font-medium">{formatNumber(row.system_qty)}</Td>
                    <Td align="right">
                      {editable ? (
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          value={value}
                          onChange={(event) => setPhysical((current) => ({ ...current, [row.id]: event.target.value }))}
                          className="ml-auto h-9 w-24 text-right"
                          placeholder="-"
                        />
                      ) : (
                        <span className="font-medium">{row.physical_qty === null ? '-' : formatNumber(row.physical_qty)}</span>
                      )}
                    </Td>
                    <Td align="right">
                      {difference === null || !hasValue && row.physical_qty === null ? (
                        <span className="text-slate-400">-</span>
                      ) : (
                        <Badge tone={Math.abs(Number(difference)) < 1e-9 ? 'green' : Number(difference) > 0 ? 'blue' : 'red'}>
                          {Number(difference) > 0 ? '+' : ''}{formatNumber(difference)}
                        </Badge>
                      )}
                    </Td>
                    <Td>
                      {editable ? (
                        <Input
                          value={reasons[row.id] ?? ''}
                          onChange={(event) => setReasons((current) => ({ ...current, [row.id]: event.target.value }))}
                          placeholder={hasDiff ? 'Wajib diisi...' : 'Opsional'}
                          className="h-9 min-w-[180px] text-xs"
                        />
                      ) : (
                        <span className="text-xs text-slate-600">{row.reason ?? '-'}</span>
                      )}
                    </Td>
                    {editable ? (
                      <Td align="right">
                        <Button
                          size="sm"
                          variant="outline"
                          loading={savingId === row.id}
                          onClick={() => void saveRow(row)}
                          icon={<Save className="h-3.5 w-3.5" />}
                        >
                          Simpan
                        </Button>
                      </Td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="Tidak ada barang" description="Tidak ada barang yang cocok dengan pencarian." />
        )}
        {editable ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3">
            <p className="text-xs text-slate-500">
              {stats.unfilled > 0
                ? `${stats.unfilled} barang belum diisi. Semua barang wajib diisi sebelum pengajuan.`
                : 'Semua barang sudah diisi. Anda dapat mengajukan hasil opname.'}
            </p>
            <Button size="sm" onClick={() => setSubmitOpen(true)} disabled={stats.unfilled > 0} icon={<Send className="h-4 w-4" />}>
              Ajukan Opname
            </Button>
          </div>
        ) : null}
      </Card>

      <Modal
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        title="Ajukan Hasil Stok Opname"
        description="Hasil opname akan masuk ke antrean persetujuan. Saldo belum berubah sampai disetujui."
        footer={
          <>
            <Button variant="outline" onClick={() => setSubmitOpen(false)}>Batal</Button>
            <Button loading={submitting} onClick={() => void submit()} icon={<Send className="h-4 w-4" />}>Ajukan</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <div>
              <p className="text-[11px] text-slate-500">Item dihitung</p>
              <p className="font-semibold">{formatNumber(stats.filled)} / {formatNumber(details.length)}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">Item selisih</p>
              <p className="font-semibold text-amber-600">{formatNumber(stats.diffRows)}</p>
            </div>
          </div>
          {stats.diffRows > 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              Terdapat {stats.diffRows} barang dengan selisih. Pastikan alasan sudah diisi dan hasil hitung fisik telah diverifikasi.
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              Tidak ada selisih antara stok sistem dan fisik.
            </div>
          )}
          <p className="text-xs text-slate-500">
            Setelah diajukan, lembar opname tidak dapat diubah. Bila perlu perbaikan, pengaju harus menunggu keputusan atau
            menghubungi penyetuju.
          </p>
        </div>
      </Modal>
    </>
  );
}
