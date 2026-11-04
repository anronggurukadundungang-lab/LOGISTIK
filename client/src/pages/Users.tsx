import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Pencil, Plus, RefreshCw, ShieldCheck, UserCog } from 'lucide-react';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { Department, Meta } from '../types';
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
  Select,
  Spinner,
  Table,
  Td,
  Th,
} from '../components/ui';

interface Role {
  id: number;
  code: string;
  name: string;
  description: string;
  user_count: number;
}

interface UserRow {
  id: number;
  username: string;
  name: string;
  email: string | null;
  is_active: number;
  must_change_password: number;
  last_login_at: string | null;
  created_at: string;
  role_code: string;
  role_name: string;
  departments: string | null;
  departmentIds: number[];
}

const emptyUser = {
  username: '',
  name: '',
  email: '',
  password: '',
  roleId: '',
  departmentIds: [] as number[],
  isActive: true,
};

export function UsersPage() {
  const { user: currentUser } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState({ ...emptyUser });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [userResult, roleResult, meta] = await Promise.all([
        api.get<{ items: UserRow[] }>('/users', { search }),
        api.get<{ items: Role[] }>('/roles'),
        api.get<Meta>('/meta'),
      ]);
      setUsers(userResult.items);
      setRoles(roleResult.items);
      setDepartments(meta.departments);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat pengguna.');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      ...emptyUser,
      roleId: roles.length ? String(roles.find((role) => role.code === 'PIC')?.id ?? roles[0].id) : '',
    });
    setFormError('');
    setModal(true);
  };

  const openEdit = (row: UserRow) => {
    setEditing(row);
    setForm({
      username: row.username,
      name: row.name,
      email: row.email ?? '',
      password: '',
      roleId: String(roles.find((role) => role.code === row.role_code)?.id ?? ''),
      departmentIds: row.departmentIds,
      isActive: Boolean(row.is_active),
    });
    setFormError('');
    setModal(true);
  };

  const toggleDepartment = (id: number) => {
    setForm((current) => ({
      ...current,
      departmentIds: current.departmentIds.includes(id)
        ? current.departmentIds.filter((value) => value !== id)
        : [...current.departmentIds, id],
    }));
  };

  const save = async () => {
    setFormError('');
    if (!editing) {
      if (form.username.trim().length < 3 || form.name.trim().length < 2) {
        setFormError('Nama pengguna minimal 3 karakter dan nama lengkap wajib diisi.');
        return;
      }
      if (form.password.length < 8) {
        setFormError('Kata sandi minimal 8 karakter.');
        return;
      }
    }
    if (!form.roleId) {
      setFormError('Pilih role pengguna.');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/users/${editing.id}`, {
          name: form.name,
          email: form.email || null,
          roleId: Number(form.roleId),
          isActive: form.isActive,
          departmentIds: form.departmentIds,
        });
        toast.success('Data pengguna diperbarui.');
      } else {
        await api.post('/users', {
          username: form.username,
          name: form.name,
          email: form.email || null,
          password: form.password,
          roleId: Number(form.roleId),
          departmentIds: form.departmentIds,
        });
        toast.success('Pengguna baru dibuat. Pengguna wajib mengganti kata sandi saat login.');
      }
      setModal(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal menyimpan pengguna.');
    } finally {
      setSaving(false);
    }
  };

  const doReset = async () => {
    if (!resetTarget) return;
    setResetting(true);
    setTemporaryPassword('');
    try {
      const result = await api.post<{ temporaryPassword: string; message: string }>(`/users/${resetTarget.id}/reset-password`, {});
      setTemporaryPassword(result.temporaryPassword);
      toast.success('Kata sandi berhasil direset.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mereset kata sandi.');
    } finally {
      setResetting(false);
    }
  };

  const selectedRole = roles.find((role) => String(role.id) === form.roleId);
  const requiresDepartment = selectedRole ? ['KEPALA_BAGIAN', 'PIC'].includes(selectedRole.code) : false;

  return (
    <>
      <PageHeader
        title="Pengguna & Role"
        subtitle="Kelola akun, role, dan penugasan bagian. Cakupan data ditentukan oleh bagian yang ditugaskan, bukan hanya oleh tampilan."
        actions={
          <>
            <Button variant="outline" onClick={() => void load()} loading={loading} icon={<RefreshCw className="h-4 w-4" />}>Muat ulang</Button>
            <Button onClick={openCreate} icon={<Plus className="h-4 w-4" />}>Tambah Pengguna</Button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {roles.slice(0, 4).map((role) => (
          <Card key={role.id} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{role.code.replaceAll('_', ' ')}</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">{role.user_count}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{role.name}</p>
              </div>
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><ShieldCheck className="h-4 w-4" /></span>
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <div className="border-b border-slate-100 p-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Cari nama pengguna atau username..." className="max-w-md" />
        </div>
        {error ? <div className="m-4 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{error}</div> : null}
        {loading && !users.length ? (
          <Spinner />
        ) : users.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Pengguna</Th>
                <Th>Role</Th>
                <Th>Bagian</Th>
                <Th>Status</Th>
                <Th>Login terakhir</Th>
                <Th align="right">Aksi</Th>
              </tr>
            </thead>
            <tbody>
              {users.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/60">
                  <Td>
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                        {row.name.slice(0, 1).toUpperCase()}
                      </span>
                      <div>
                        <p className="font-medium text-slate-800">{row.name} {row.id === currentUser?.id ? <span className="text-[10px] text-brand-700">(Anda)</span> : null}</p>
                        <p className="text-[11px] text-slate-500">@{row.username}{row.email ? ` · ${row.email}` : ''}</p>
                      </div>
                    </div>
                  </Td>
                  <Td><Badge tone="blue">{row.role_name}</Badge></Td>
                  <Td>
                    <p className="max-w-[260px] truncate text-xs text-slate-600">{row.departments ?? 'Semua bagian'}</p>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {row.is_active ? <Badge tone="green">Aktif</Badge> : <Badge tone="gray">Nonaktif</Badge>}
                      {row.must_change_password ? <Badge tone="yellow">Ganti sandi</Badge> : null}
                    </div>
                  </Td>
                  <Td className="text-[11px] text-slate-500">{row.last_login_at ? formatDateTime(row.last_login_at) : 'Belum pernah'}</Td>
                  <Td align="right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" onClick={() => openEdit(row)} icon={<Pencil className="h-3.5 w-3.5" />}>Ubah</Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setResetTarget(row); setTemporaryPassword(''); }}
                        icon={<KeyRound className="h-3.5 w-3.5" />}
                      >
                        Reset
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="Pengguna tidak ditemukan" description="Ubah pencarian atau tambahkan pengguna baru." />
        )}
      </Card>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editing ? 'Ubah Pengguna' : 'Tambah Pengguna'}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setModal(false)}>Batal</Button>
            <Button loading={saving} onClick={() => void save()}>Simpan</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nama pengguna (username)" required>
            <Input value={form.username} disabled={Boolean(editing)} onChange={(event) => setForm({ ...form, username: event.target.value.replace(/\s/g, '') })} placeholder="contoh: pic.aftap" />
          </Field>
          <Field label="Nama lengkap" required>
            <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Nama lengkap" />
          </Field>
          <Field label="Email" hint="Opsional.">
            <Input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="nama@instansi.go.id" />
          </Field>
          {!editing ? (
            <Field label="Kata sandi awal" required hint="Minimal 8 karakter, harus mengandung huruf dan angka.">
              <Input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="new-password" />
            </Field>
          ) : null}
          <Field label="Role" required hint={selectedRole?.description}>
            <Select value={form.roleId} onChange={(event) => setForm({ ...form, roleId: event.target.value })}>
              <option value="">Pilih role</option>
              {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </Select>
          </Field>
          {editing ? (
            <div className="flex items-center gap-2 pt-6">
              <input id="user-active" type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
              <label htmlFor="user-active" className="text-xs text-slate-600">Akun aktif (dapat login)</label>
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-xs font-medium text-slate-700">
              Penugasan bagian {requiresDepartment ? <span className="text-rose-500">*</span> : null}
            </p>
            <p className="mb-2 text-[11px] text-slate-500">
              {requiresDepartment ? 'Role ini wajib memiliki minimal satu bagian.' : 'Kosongkan bila pengguna berhak atas seluruh bagian sesuai role.'}
            </p>
            <div className="grid max-h-52 gap-1.5 overflow-y-auto rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
              {departments.map((department) => (
                <label key={department.id} className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.departmentIds.includes(department.id)}
                    onChange={() => toggleDepartment(department.id)}
                  />
                  {department.name}
                </label>
              ))}
            </div>
          </div>
          {formError ? <div className="sm:col-span-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{formError}</div> : null}
        </div>
      </Modal>

      <Modal
        open={Boolean(resetTarget)}
        onClose={() => { setResetTarget(null); setTemporaryPassword(''); }}
        title="Reset Kata Sandi"
        description={resetTarget ? `${resetTarget.name} (@${resetTarget.username})` : undefined}
        footer={
          temporaryPassword ? (
            <Button onClick={() => { setResetTarget(null); setTemporaryPassword(''); }}>Selesai</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setResetTarget(null)}>Batal</Button>
              <Button loading={resetting} variant="danger" onClick={() => void doReset()} icon={<KeyRound className="h-4 w-4" />}>Reset Kata Sandi</Button>
            </>
          )
        }
      >
        {temporaryPassword ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              Kata sandi berhasil direset. Semua sesi pengguna ini telah diakhiri.
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] text-slate-500">Kata sandi sementara</p>
              <p className="mt-1 select-all font-mono text-lg font-semibold text-slate-900">{temporaryPassword}</p>
            </div>
            <p className="text-xs leading-5 text-slate-500">
              Sampaikan kata sandi ini secara aman. Pengguna wajib menggantinya saat login berikutnya.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm leading-6 text-slate-600">
              Kata sandi akan diganti dengan kata sandi sementara acak. Pengguna harus menggantinya saat login.
            </p>
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <UserCog className="mt-0.5 h-4 w-4 shrink-0" />
              Tindakan ini akan mengakhiri seluruh sesi aktif pengguna tersebut dan dicatat pada audit trail.
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
