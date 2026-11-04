import { useCallback, useEffect, useState } from 'react';
import { Building2, Pencil, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { Department } from '../types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  Spinner,
  Table,
  Td,
  Th,
} from '../components/ui';

export function DepartmentsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<Department[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [form, setForm] = useState({ code: '', simdondarCode: '', name: '', headName: '', isActive: true });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const canManage = can('departments.manage');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.get<{ items: Department[] }>('/departments');
      setItems(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat daftar bagian.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ code: '', simdondarCode: '', name: '', headName: '', isActive: true });
    setFormError('');
    setModal(true);
  };

  const openEdit = (department: Department) => {
    setEditing(department);
    setForm({
      code: department.code,
      simdondarCode: department.simdondar_code ?? '',
      name: department.name,
      headName: department.head_name ?? '',
      isActive: Boolean(department.is_active),
    });
    setFormError('');
    setModal(true);
  };

  const save = async () => {
    setFormError('');
    if (form.name.trim().length < 2) {
      setFormError('Nama bagian minimal 2 karakter.');
      return;
    }
    setSaving(true);
    try {
      const body = {
        code: form.code || null,
        simdondarCode: form.simdondarCode || null,
        name: form.name,
        headName: form.headName || null,
        isActive: form.isActive,
      };
      if (editing) {
        await api.patch(`/departments/${editing.id}`, body);
        toast.success('Bagian diperbarui.');
      } else {
        await api.post('/departments', body);
        toast.success('Bagian ditambahkan.');
      }
      setModal(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal menyimpan bagian.');
    } finally {
      setSaving(false);
    }
  };

  const filtered = items.filter(
    (item) =>
      !search ||
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.code.toLowerCase().includes(search.toLowerCase()) ||
      (item.simdondar_code ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="Master Bagian"
        subtitle="Daftar bagian/unit penerima. Kode SIMDONDAR digunakan untuk mencocokkan bagian saat impor pengeluaran."
        actions={canManage ? <Button onClick={openCreate} icon={<Plus className="h-4 w-4" />}>Tambah Bagian</Button> : null}
      />

      <Card>
        <div className="border-b border-slate-100 p-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Cari nama, kode, atau kode SIMDONDAR..." className="max-w-md" />
        </div>
        {error ? <div className="m-4 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{error}</div> : null}
        {loading ? (
          <Spinner />
        ) : filtered.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Nama bagian</Th>
                <Th>Kode internal</Th>
                <Th>Kode SIMDONDAR</Th>
                <Th>Kepala bagian</Th>
                <Th align="right">Barang bersaldo</Th>
                <Th>Status</Th>
                {canManage ? <Th align="right">Aksi</Th> : null}
              </tr>
            </thead>
            <tbody>
              {filtered.map((department) => (
                <tr key={department.id} className="hover:bg-slate-50/60">
                  <Td>
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><Building2 className="h-4 w-4" /></span>
                      <span className="font-medium text-slate-800">{department.name}</span>
                    </div>
                  </Td>
                  <Td><span className="font-mono text-[11px] text-slate-600">{department.code}</span></Td>
                  <Td><span className="font-mono text-[11px] text-slate-600">{department.simdondar_code ?? '-'}</span></Td>
                  <Td className="text-xs">{department.head_name ?? '-'}</Td>
                  <Td align="right" className="text-xs">{formatNumber(department.item_count ?? 0)}</Td>
                  <Td>{department.is_active ? <Badge tone="green">Aktif</Badge> : <Badge tone="gray">Nonaktif</Badge>}</Td>
                  {canManage ? (
                    <Td align="right">
                      <Button size="sm" variant="outline" onClick={() => openEdit(department)} icon={<Pencil className="h-3.5 w-3.5" />}>Ubah</Button>
                    </Td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="Bagian tidak ditemukan" description="Ubah kata kunci pencarian atau tambahkan bagian baru." />
        )}
      </Card>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editing ? 'Ubah Bagian' : 'Tambah Bagian'}
        footer={
          <>
            <Button variant="outline" onClick={() => setModal(false)}>Batal</Button>
            <Button loading={saving} onClick={() => void save()}>Simpan</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nama bagian" required className="sm:col-span-2">
            <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Contoh: Aftap" />
          </Field>
          <Field label="Kode internal" hint="Kosongkan untuk dibuat otomatis.">
            <Input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="DEPT-01" />
          </Field>
          <Field label="Kode SIMDONDAR">
            <Input value={form.simdondarCode} onChange={(event) => setForm({ ...form, simdondarCode: event.target.value })} placeholder="Kode bagian di SIMDONDAR" />
          </Field>
          <Field label="Kepala bagian" className="sm:col-span-2">
            <Input value={form.headName} onChange={(event) => setForm({ ...form, headName: event.target.value })} placeholder="Nama kepala bagian" />
          </Field>
          <label className="flex items-center gap-2 text-xs text-slate-600 sm:col-span-2">
            <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
            Bagian aktif
          </label>
          {formError ? <div className="sm:col-span-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{formError}</div> : null}
        </div>
      </Modal>
    </>
  );
}
