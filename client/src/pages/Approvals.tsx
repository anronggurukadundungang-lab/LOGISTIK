import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Eye, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { formatDate, formatDateTime, formatNumber } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { Approval, Department, Meta, Paginated } from '../types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  InfoBanner,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Spinner,
  StatusBadge,
  Table,
  Tabs,
  Td,
  Textarea,
  Th,
} from '../components/ui';

export const APPROVAL_TYPE_LABELS: Record<string, string> = {
  DAMAGE: 'Barang Rusak',
  LOSS: 'Barang Hilang',
  EXPIRED: 'Barang Kedaluwarsa',
  ADJUSTMENT: 'Penyesuaian Stok',
  CORRECTION: 'Koreksi Pemakaian',
  OPNAME: 'Stok Opname',
};

interface ApprovalDetail {
  item: Approval & {
    item_code?: string | null;
    role?: string;
    payload: Record<string, unknown>;
  };
  opname: { id: number; period: string; status: string; opname_date: string } | null;
}

export function ApprovalsPage() {
  const { user, can } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('status') ?? 'PENDING');
  const [type, setType] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<Approval> | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Approval | null>(null);
  const [detail, setDetail] = useState<ApprovalDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [note, setNote] = useState('');
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    api.get<Meta>('/meta').then(setMeta).catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.get<Paginated<Approval>>('/approvals', {
        page,
        pageSize: 20,
        status: tab,
        type: type || undefined,
        departmentId: departmentId || undefined,
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat antrean persetujuan.');
    } finally {
      setLoading(false);
    }
  }, [page, tab, type, departmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (approval: Approval) => {
    setSelected(approval);
    setDetail(null);
    setNote('');
    setDecision(null);
    setFormError('');
    setDetailLoading(true);
    try {
      const result = await api.get<ApprovalDetail>(`/approvals/${approval.id}`);
      setDetail(result);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal memuat detail pengajuan.');
    } finally {
      setDetailLoading(false);
    }
  };

  const submitDecision = async () => {
    if (!selected || !decision) return;
    setFormError('');
    if (decision === 'reject' && note.trim().length < 5) {
      setFormError('Alasan penolakan minimal 5 karakter.');
      return;
    }
    setSaving(true);
    try {
      if (decision === 'approve') {
        await api.post(`/approvals/${selected.id}/approve`, { note: note || null });
        toast.success('Pengajuan disetujui dan transaksi telah dibukukan.');
      } else {
        await api.post(`/approvals/${selected.id}/reject`, { note });
        toast.success('Pengajuan ditolak. Saldo tidak berubah.');
      }
      setSelected(null);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal memproses keputusan.');
    } finally {
      setSaving(false);
    }
  };

  const departments: Department[] = meta?.departments ?? [];
  const payload = detail?.item.payload ?? {};
  const isOwn = selected ? Number((selected as unknown as { requested_by: number }).requested_by) === user?.id : false;
  const canDecide = can('approvals.decide') && selected?.status === 'PENDING' && !isOwn;

  return (
    <>
      <PageHeader
        title="Persetujuan"
        subtitle="Tinjau pengajuan penyesuaian, rusak/hilang, koreksi pemakaian, dan hasil stok opname. Keputusan tercatat pada audit trail."
        actions={<Button variant="outline" onClick={() => void load()} loading={loading} icon={<RefreshCw className="h-4 w-4" />}>Muat ulang</Button>}
      />

      <Card>
        <div className="border-b border-slate-100 px-3 pt-1">
          <Tabs
            tabs={[
              { key: 'PENDING', label: 'Menunggu' },
              { key: 'APPROVED', label: 'Disetujui' },
              { key: 'REJECTED', label: 'Ditolak' },
              { key: 'ALL', label: 'Semua' },
            ]}
            active={tab}
            onChange={(key) => { setTab(key); setPage(1); }}
          />
        </div>
        <div className="grid gap-2.5 border-b border-slate-100 p-3 sm:grid-cols-3">
          <Select value={type} onChange={(event) => { setType(event.target.value); setPage(1); }}>
            <option value="">Semua jenis</option>
            {Object.entries(APPROVAL_TYPE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </Select>
          <Select value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setPage(1); }}>
            <option value="">Semua bagian</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>{department.name}</option>
            ))}
          </Select>
          <div className="hidden sm:block" />
        </div>

        {error ? <div className="m-4 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{error}</div> : null}

        {loading && !data ? (
          <Spinner />
        ) : data && data.items.length ? (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Jenis</Th>
                  <Th>Ringkasan</Th>
                  <Th>Bagian</Th>
                  <Th>Pemohon</Th>
                  <Th>Diajukan</Th>
                  <Th>Status</Th>
                  <Th align="right">Aksi</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((approval) => (
                  <tr key={approval.id} className="hover:bg-slate-50/60">
                    <Td><Badge tone={approval.type === 'OPNAME' ? 'purple' : approval.type === 'CORRECTION' ? 'blue' : approval.type === 'ADJUSTMENT' ? 'teal' : 'red'}>{APPROVAL_TYPE_LABELS[approval.type] ?? approval.type}</Badge></Td>
                    <Td>
                      <p className="max-w-[320px] truncate text-sm text-slate-800">{approval.summary}</p>
                      <p className="max-w-[320px] truncate text-[11px] text-slate-500">{approval.reason}</p>
                    </Td>
                    <Td className="text-xs">{approval.department_name}</Td>
                    <Td className="text-xs">
                      {approval.requester_name}
                      {approval.is_own_request ? <span className="ml-1 text-[10px] text-amber-600">(Anda)</span> : null}
                    </Td>
                    <Td>
                      <p className="text-[11px] text-slate-600">{formatDate(approval.created_at)}</p>
                      <p className="text-[10px] text-slate-400">{formatDateTime(approval.created_at).split(' ').slice(-1)}</p>
                    </Td>
                    <Td><StatusBadge status={approval.status} /></Td>
                    <Td align="right">
                      <Button size="sm" variant="outline" onClick={() => void open(approval)} icon={<Eye className="h-3.5 w-3.5" />}>
                        {approval.status === 'PENDING' && can('approvals.decide') ? 'Tinjau' : 'Detail'}
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} total={data.pagination.total} onChange={setPage} />
          </>
        ) : (
          <EmptyState
            title={tab === 'PENDING' ? 'Tidak ada pengajuan menunggu' : 'Belum ada data'}
            description="Pengajuan baru dari bagian akan muncul di sini untuk ditinjau."
          />
        )}
      </Card>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="Tinjau Pengajuan"
        description={selected ? `${APPROVAL_TYPE_LABELS[selected.type] ?? selected.type} · ${selected.department_name}` : undefined}
        size="lg"
        footer={
          selected?.status === 'PENDING' && can('approvals.decide') ? (
            isOwn ? (
              <span className="text-xs text-amber-700">Anda tidak dapat menyetujui pengajuan sendiri.</span>
            ) : decision ? (
              <>
                <Button variant="outline" onClick={() => setDecision(null)}>Kembali</Button>
                <Button
                  variant={decision === 'reject' ? 'danger' : 'primary'}
                  loading={saving}
                  onClick={() => void submitDecision()}
                  icon={decision === 'reject' ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                >
                  {decision === 'reject' ? 'Tolak Pengajuan' : 'Setujui & Bukukan'}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setSelected(null)}>Tutup</Button>
                <Button variant="danger" onClick={() => setDecision('reject')} icon={<XCircle className="h-4 w-4" />}>Tolak</Button>
                <Button onClick={() => setDecision('approve')} icon={<CheckCircle2 className="h-4 w-4" />}>Setujui</Button>
              </>
            )
          ) : (
            <Button variant="outline" onClick={() => setSelected(null)}>Tutup</Button>
          )
        }
      >
        {selected ? (
          detailLoading ? (
            <Spinner />
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={selected.status} />
                  <Badge tone="gray">{APPROVAL_TYPE_LABELS[selected.type] ?? selected.type}</Badge>
                  {isOwn ? <Badge tone="yellow">Pengajuan Anda</Badge> : null}
                </div>
                <p className="mt-2 text-sm font-medium text-slate-800">{selected.summary}</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">{selected.reason}</p>
                <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <div><dt className="text-slate-500">Bagian</dt><dd className="font-medium text-slate-800">{selected.department_name}</dd></div>
                  <div><dt className="text-slate-500">Pemohon</dt><dd className="font-medium text-slate-800">{selected.requester_name}</dd></div>
                  <div><dt className="text-slate-500">Diajukan</dt><dd className="font-medium text-slate-800">{formatDateTime(selected.created_at)}</dd></div>
                  <div><dt className="text-slate-500">Barang</dt><dd className="font-medium text-slate-800">{selected.item_name ?? '-'}</dd></div>
                </dl>
              </div>

              {selected.status !== 'PENDING' ? (
                <InfoBanner tone={selected.status === 'APPROVED' ? 'success' : 'danger'} title={`${statusLabelSafe(selected.status)}${selected.decided_by_name ? ` oleh ${selected.decided_by_name}` : ''}`}>
                  {selected.decision_note ?? 'Tidak ada catatan keputusan.'}
                  {selected.decided_at ? ` · ${formatDateTime(selected.decided_at)}` : ''}
                </InfoBanner>
              ) : null}

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Rincian pengajuan</p>
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-slate-100">
                      {Object.entries(payload).map(([key, value]) => (
                        <tr key={key}>
                          <td className="w-1/3 bg-slate-50 px-3 py-2 font-medium text-slate-500">{payloadLabel(key)}</td>
                          <td className="px-3 py-2 text-slate-800">{payloadValue(key, value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {detail?.opname ? (
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs font-semibold text-slate-700">Sesi opname terkait</p>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-600">{detail.opname.period} · {formatDate(detail.opname.opname_date)}</span>
                    <Link to={`/opname/${detail.opname.id}`} className="font-medium text-brand-700 hover:underline" onClick={() => setSelected(null)}>
                      Buka lembar opname
                    </Link>
                  </div>
                </div>
              ) : null}

              {selected.status === 'PENDING' && can('approvals.decide') && !isOwn && decision ? (
                <div className="space-y-3 border-t border-slate-100 pt-3">
                  {decision === 'approve' ? (
                    <>
                      <InfoBanner tone="info" title="Persetujuan akan membukukan transaksi">
                        Saldo stok akan berubah sesuai rincian di atas dan tercatat pada ledger. Tindakan ini tidak dapat dibatalkan,
                        hanya dapat dikoreksi melalui pengajuan baru.
                      </InfoBanner>
                      <Field label="Catatan persetujuan (opsional)">
                        <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Opsional" />
                      </Field>
                    </>
                  ) : (
                    <>
                      <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                        Penolakan tidak mengubah saldo. Alasan akan dikirim ke pemohon dan dicatat pada audit trail.
                      </div>
                      <Field label="Alasan penolakan" required error={formError}>
                        <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Jelaskan alasan penolakan (minimal 5 karakter)." />
                      </Field>
                    </>
                  )}
                  {decision === 'approve' && formError ? <p className="text-xs text-rose-600">{formError}</p> : null}
                </div>
              ) : null}
            </div>
          )
        ) : null}
      </Modal>
    </>
  );
}

function statusLabelSafe(status: string): string {
  return status === 'APPROVED' ? 'Disetujui' : status === 'REJECTED' ? 'Ditolak' : status;
}

const PAYLOAD_LABELS: Record<string, string> = {
  qty: 'Jumlah',
  qtyDelta: 'Perubahan qty',
  occurredAt: 'Tanggal transaksi',
  notes: 'Keterangan',
  description: 'Deskripsi',
  entryId: 'ID transaksi',
  newQty: 'Jumlah baru',
  originalEntryNo: 'No. transaksi asli',
  activityCategory: 'Kategori kegiatan',
  officerName: 'Petugas',
  sessionId: 'ID sesi',
};

function payloadLabel(key: string): string {
  return PAYLOAD_LABELS[key] ?? key;
}

function payloadValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (key === 'occurredAt') return formatDate(String(value));
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
