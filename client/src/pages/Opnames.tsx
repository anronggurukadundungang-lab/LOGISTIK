import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, ClipboardCheck, Plus, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { formatDate, formatNumber, today } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { Department, Meta, OpnameSession, Paginated } from '../types';
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Spinner,
  StatusBadge,
  Table,
  Td,
  Textarea,
  Th,
} from '../components/ui';

export function OpnamesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<OpnameSession> | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [formDepartment, setFormDepartment] = useState('');
  const [formDate, setFormDate] = useState(today());
  const [formPeriod, setFormPeriod] = useState(today().slice(0, 7));
  const [formNotes, setFormNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    api.get<Meta>('/meta').then((result) => {
      setMeta(result);
      if (result.departments.length) setFormDepartment(String(result.departments[0].id));
    }).catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.get<Paginated<OpnameSession>>('/opnames', {
        page,
        pageSize: 20,
        status: status || undefined,
        departmentId: departmentId || undefined,
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat stok opname.');
    } finally {
      setLoading(false);
    }
  }, [page, status, departmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const departments: Department[] = meta?.departments ?? [];

  const start = async () => {
    setFormError('');
    if (!formDepartment) {
      setFormError('Pilih bagian.');
      return;
    }
    setSaving(true);
    try {
      const result = await api.post<{ message: string; id: number }>('/opnames', {
        departmentId: Number(formDepartment),
        opnameDate: formDate,
        period: formPeriod,
        notes: formNotes || null,
      });
      toast.success(result.message);
      setOpen(false);
      setFormNotes('');
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal membuat sesi opname.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Stok Opname"
        subtitle="Hitung fisik barang per bagian, catat selisih, lalu ajukan untuk persetujuan. Saldo hanya berubah setelah disetujui."
        actions={
          <>
            <Button variant="outline" onClick={() => void load()} loading={loading} icon={<RefreshCw className="h-4 w-4" />}>Muat ulang</Button>
            {can('opnames.create') ? (
              <Button onClick={() => setOpen(true)} icon={<Plus className="h-4 w-4" />}>Mulai Opname</Button>
            ) : null}
          </>
        }
      />

      <Card>
        <div className="grid gap-2.5 border-b border-slate-100 p-3 sm:grid-cols-3">
          <Select value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setPage(1); }}>
            <option value="">Semua bagian</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>{department.name}</option>
            ))}
          </Select>
          <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="">Semua status</option>
            <option value="DRAFT">Draf</option>
            <option value="SUBMITTED">Diajukan</option>
            <option value="APPROVED">Disetujui</option>
            <option value="REJECTED">Ditolak</option>
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
                  <Th>Periode / Tanggal</Th>
                  <Th>Bagian</Th>
                  <Th>Status</Th>
                  <Th align="right">Item</Th>
                  <Th align="right">Selisih</Th>
                  <Th align="right">Belum diisi</Th>
                  <Th>Dibuat</Th>
                  <Th align="right">Aksi</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((session) => (
                  <tr key={session.id} className="hover:bg-slate-50/60">
                    <Td>
                      <p className="font-medium text-slate-800">{session.period}</p>
                      <p className="text-[11px] text-slate-500">{formatDate(session.opname_date)}</p>
                    </Td>
                    <Td className="text-xs">{session.department_name}</Td>
                    <Td><StatusBadge status={session.status} /></Td>
                    <Td align="right" className="text-xs">{formatNumber(session.item_count)}</Td>
                    <Td align="right">
                      <span className={session.diff_count > 0 ? 'font-semibold text-amber-600' : 'text-slate-500'}>
                        {formatNumber(session.diff_count)}
                      </span>
                    </Td>
                    <Td align="right">
                      <span className={session.unfilled_count > 0 ? 'text-xs font-medium text-rose-600' : 'text-xs text-slate-500'}>
                        {formatNumber(session.unfilled_count)}
                      </span>
                    </Td>
                    <Td>
                      <p className="text-[11px] text-slate-600">{session.created_by_name}</p>
                      <p className="text-[10px] text-slate-400">{formatDate(session.created_at)}</p>
                    </Td>
                    <Td align="right">
                      <Link to={`/opname/${session.id}`} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50">
                        <ClipboardCheck className="h-3.5 w-3.5" /> Buka
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
            title="Belum ada sesi opname"
            description="Mulai opname untuk menghitung fisik barang pada suatu bagian. Sesi memuat seluruh barang yang memiliki saldo pada bagian tersebut."
          />
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Mulai Stok Opname"
        description="Sistem akan mengambil snapshot saldo seluruh barang bersaldo pada bagian terpilih."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button loading={saving} onClick={() => void start()} icon={<CalendarCheck className="h-4 w-4" />}>Buat Sesi</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Bagian" required>
            <Select value={formDepartment} onChange={(event) => setFormDepartment(event.target.value)}>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tanggal opname" required>
              <Input type="date" value={formDate} max={today()} onChange={(event) => {
                setFormDate(event.target.value);
                if (event.target.value) setFormPeriod(event.target.value.slice(0, 7));
              }} />
            </Field>
            <Field label="Periode" required hint="Format YYYY-MM.">
              <Input type="month" value={formPeriod} onChange={(event) => setFormPeriod(event.target.value)} />
            </Field>
          </div>
          <Field label="Catatan">
            <Textarea value={formNotes} onChange={(event) => setFormNotes(event.target.value)} placeholder="Misalnya: opname akhir bulan, tim penghitung, dll." />
          </Field>
          {formError ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{formError}</div> : null}
        </div>
      </Modal>
    </>
  );
}
