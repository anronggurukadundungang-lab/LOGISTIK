import { useCallback, useEffect, useState } from 'react';
import { Eye, RefreshCw, ScrollText } from 'lucide-react';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { Pagination } from '../types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Pagination as PaginationBar,
  SearchInput,
  Select,
  Spinner,
  Table,
  Td,
  Th,
} from '../components/ui';

interface AuditRow {
  id: number;
  actor_id: number | null;
  actor_name: string | null;
  username: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_json: string | null;
  after_json: string | null;
  reason: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

interface AuditResponse {
  items: AuditRow[];
  pagination: Pagination;
  meta: { actions: string[]; entities: string[] };
}

function prettyJson(value: string | null): string {
  if (!value) return '-';
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export function AuditPage() {
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<AuditRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.get<AuditResponse>('/audit', {
        page,
        pageSize: 30,
        search,
        action: action || undefined,
        entityType: entityType || undefined,
        from: from || undefined,
        to: to || undefined,
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat audit trail.');
    } finally {
      setLoading(false);
    }
  }, [page, search, action, entityType, from, to]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <>
      <PageHeader
        title="Audit Trail"
        subtitle="Catatan aktivitas sistem yang tidak dapat diubah. Menampilkan pelaku, aksi, entitas, nilai sebelum/sesudah, alamat IP, dan waktu."
        actions={<Button variant="outline" onClick={() => void load()} loading={loading} icon={<RefreshCw className="h-4 w-4" />}>Muat ulang</Button>}
      />

      <Card>
        <div className="grid gap-2.5 border-b border-slate-100 p-3 sm:grid-cols-2 xl:grid-cols-5">
          <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Cari aksi, pelaku, alasan..." className="xl:col-span-2" />
          <Select value={action} onChange={(event) => { setAction(event.target.value); setPage(1); }}>
            <option value="">Semua aksi</option>
            {(data?.meta.actions ?? []).map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
          <Select value={entityType} onChange={(event) => { setEntityType(event.target.value); setPage(1); }}>
            <option value="">Semua entitas</option>
            {(data?.meta.entities ?? []).map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} aria-label="Dari tanggal" />
            <Input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} aria-label="Sampai tanggal" />
          </div>
        </div>

        {error ? <div className="m-4 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{error}</div> : null}

        {loading && !data ? (
          <Spinner />
        ) : data && data.items.length ? (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Waktu</Th>
                  <Th>Pelaku</Th>
                  <Th>Aksi</Th>
                  <Th>Entitas</Th>
                  <Th>Alasan</Th>
                  <Th>IP</Th>
                  <Th align="right">Detail</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/60">
                    <Td className="whitespace-nowrap text-[11px] text-slate-500">{formatDateTime(row.created_at)}</Td>
                    <Td>
                      <p className="text-xs font-medium text-slate-700">{row.actor_name ?? 'Sistem'}</p>
                      <p className="text-[10px] text-slate-400">{row.username ? `@${row.username}` : '-'}</p>
                    </Td>
                    <Td><Badge tone={row.action.includes('DELETE') || row.action.includes('REJECT') ? 'red' : row.action.includes('CREATE') || row.action.includes('APPROVE') ? 'green' : 'blue'}>{row.action}</Badge></Td>
                    <Td>
                      <p className="text-xs text-slate-600">{row.entity_type}</p>
                      <p className="font-mono text-[10px] text-slate-400">{row.entity_id ?? '-'}</p>
                    </Td>
                    <Td><p className="max-w-[220px] truncate text-[11px] text-slate-500">{row.reason ?? '-'}</p></Td>
                    <Td><span className="font-mono text-[10px] text-slate-500">{row.ip ?? '-'}</span></Td>
                    <Td align="right">
                      <Button size="sm" variant="outline" onClick={() => setSelected(row)} icon={<Eye className="h-3.5 w-3.5" />}>Lihat</Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <PaginationBar page={data.pagination.page} totalPages={data.pagination.totalPages} total={data.pagination.total} onChange={setPage} />
          </>
        ) : (
          <EmptyState title="Tidak ada catatan audit" description="Aktivitas akan tercatat otomatis saat pengguna melakukan tindakan." />
        )}
      </Card>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="Detail Audit"
        description={selected ? `${selected.action} · ${selected.entity_type} ${selected.entity_id ?? ''}` : undefined}
        size="lg"
        footer={<Button variant="outline" onClick={() => setSelected(null)}>Tutup</Button>}
      >
        {selected ? (
          <div className="space-y-4">
            <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs sm:grid-cols-2">
              <div><p className="text-slate-500">Waktu</p><p className="font-medium text-slate-800">{formatDateTime(selected.created_at)}</p></div>
              <div><p className="text-slate-500">Pelaku</p><p className="font-medium text-slate-800">{selected.actor_name ?? 'Sistem'} {selected.username ? `(@${selected.username})` : ''}</p></div>
              <div><p className="text-slate-500">Alamat IP</p><p className="font-medium text-slate-800">{selected.ip ?? '-'}</p></div>
              <div><p className="text-slate-500">Perangkat</p><p className="max-w-full truncate font-medium text-slate-800">{selected.user_agent ?? '-'}</p></div>
              <div className="sm:col-span-2"><p className="text-slate-500">Alasan</p><p className="font-medium text-slate-800">{selected.reason ?? '-'}</p></div>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Sebelum</p>
                <pre className="max-h-72 overflow-auto rounded-lg border border-slate-200 bg-slate-900 p-3 text-[11px] leading-5 text-slate-100">{prettyJson(selected.before_json)}</pre>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Sesudah</p>
                <pre className="max-h-72 overflow-auto rounded-lg border border-slate-200 bg-slate-900 p-3 text-[11px] leading-5 text-slate-100">{prettyJson(selected.after_json)}</pre>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
