import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowLeftRight,
  Bell,
  Boxes,
  Building2,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  FileBarChart,
  FileSpreadsheet,
  Gauge,
  History,
  KeyRound,
  LogOut,
  Menu,
  PackageCheck,
  Settings,
  ShoppingCart,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { cn, Badge, Button, Field, Input, Modal } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  permissions?: string[];
  any?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    label: 'Ringkasan',
    items: [{ to: '/', label: 'Dashboard', icon: <Gauge className="h-4.5 w-4.5" />, permissions: ['dashboard.view'] }],
  },
  {
    label: 'Operasional',
    items: [
      { to: '/stok', label: 'Monitoring Stok', icon: <Boxes className="h-4.5 w-4.5" />, permissions: ['stocks.view'] },
      { to: '/pemakaian', label: 'Pemakaian', icon: <ShoppingCart className="h-4.5 w-4.5" />, permissions: ['consumptions.create', 'stocks.view'], any: true },
      { to: '/penerimaan', label: 'Penerimaan', icon: <PackageCheck className="h-4.5 w-4.5" />, permissions: ['receipts.confirm'] },
      { to: '/opname', label: 'Stok Opname', icon: <ClipboardCheck className="h-4.5 w-4.5" />, permissions: ['approvals.view', 'opnames.create'], any: true },
      { to: '/persetujuan', label: 'Persetujuan', icon: <ClipboardList className="h-4.5 w-4.5" />, permissions: ['approvals.view'] },
    ],
  },
  {
    label: 'Data SIMDONDAR',
    items: [
      { to: '/impor', label: 'Impor SIMDONDAR', icon: <FileSpreadsheet className="h-4.5 w-4.5" />, permissions: ['imports.view'] },
      { to: '/laporan', label: 'Laporan', icon: <FileBarChart className="h-4.5 w-4.5" />, permissions: ['reports.view'] },
    ],
  },
  {
    label: 'Master Data',
    items: [
      { to: '/barang', label: 'Barang & Satuan', icon: <ArrowLeftRight className="h-4.5 w-4.5" />, permissions: ['items.view'] },
      { to: '/bagian', label: 'Bagian', icon: <Building2 className="h-4.5 w-4.5" />, permissions: ['departments.view'] },
      { to: '/pengguna', label: 'Pengguna & Role', icon: <Users className="h-4.5 w-4.5" />, permissions: ['users.manage'] },
    ],
  },
  {
    label: 'Sistem',
    items: [
      { to: '/audit', label: 'Audit Trail', icon: <History className="h-4.5 w-4.5" />, permissions: ['audit.view'] },
      { to: '/pengaturan', label: 'Pengaturan', icon: <Settings className="h-4.5 w-4.5" />, permissions: ['settings.manage'] },
    ],
  },
];

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const { can, canAny } = useAuth();
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {NAV.map((group) => {
        const items = group.items.filter((item) => {
          if (!item.permissions?.length) return true;
          return item.any ? canAny(...item.permissions) : item.permissions.every(can);
        });
        if (!items.length) return null;
        return (
          <div key={group.label}>
            <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">{group.label}</p>
            <div className="space-y-0.5">
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-brand-700 text-white shadow-sm'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                    )
                  }
                >
                  {item.icon}
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

interface Notification {
  id: number;
  title: string;
  message: string;
  link: string | null;
  is_read: number;
  created_at: string;
}

function NotificationBell() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!can('notifications.view')) return;
    setLoading(true);
    try {
      const result = await api.get<{ items: Notification[]; unread: number }>('/notifications');
      setItems(result.items);
      setUnread(result.unread);
    } catch {
      /* notifikasi opsional */
    } finally {
      setLoading(false);
    }
  }, [can]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!can('notifications.view')) return null;

  const openItem = async (item: Notification) => {
    if (!item.is_read) {
      try {
        await api.post(`/notifications/${item.id}/read`);
        setItems((current) => current.map((row) => (row.id === item.id ? { ...row, is_read: 1 } : row)));
        setUnread((value) => Math.max(0, value - 1));
      } catch {
        /* abaikan */
      }
    }
    setOpen(false);
    if (item.link) navigate(item.link);
  };

  const readAll = async () => {
    try {
      await api.post('/notifications/read-all');
      setItems((current) => current.map((row) => ({ ...row, is_read: 1 })));
      setUnread(0);
    } catch {
      /* abaikan */
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((value) => !value)}
        className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        aria-label="Notifikasi"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 ? (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-[min(92vw,360px)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-800">Notifikasi</p>
            <button onClick={readAll} className="text-xs font-medium text-brand-700 hover:underline">
              Tandai semua dibaca
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {loading && !items.length ? (
              <p className="px-4 py-6 text-center text-xs text-slate-500">Memuat...</p>
            ) : items.length ? (
              items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => void openItem(item)}
                  className={cn(
                    'block w-full border-b border-slate-50 px-4 py-3 text-left transition hover:bg-slate-50',
                    !item.is_read && 'bg-brand-50/40',
                  )}
                >
                  <div className="flex items-start gap-2">
                    {!item.is_read ? <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" /> : <span className="mt-1.5 h-2 w-2 shrink-0" />}
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-800">{item.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-500">{item.message}</p>
                      <p className="mt-1 text-[10px] text-slate-400">{formatDateTime(item.created_at)}</p>
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <p className="px-4 py-8 text-center text-xs text-slate-500">Belum ada notifikasi.</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (newPassword !== confirmPassword) {
      setError('Konfirmasi kata sandi tidak sama.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      toast.success('Kata sandi berhasil diubah.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengubah kata sandi.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ubah Kata Sandi"
      description="Gunakan minimal 8 karakter dengan kombinasi huruf dan angka."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button loading={saving} onClick={() => void submit()}>Simpan Kata Sandi</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Kata sandi saat ini" required>
          <Input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" />
        </Field>
        <Field label="Kata sandi baru" required>
          <Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Ulangi kata sandi baru" required error={error}>
          <Input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" />
        </Field>
      </div>
    </Modal>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDrawer(false);
    setMenu(false);
  }, [location.pathname]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    document.title = 'Monitoring Stok Per Bagian';
  }, []);

  const doLogout = async () => {
    await logout();
    toast.info('Anda telah keluar.');
    navigate('/login', { replace: true });
  };

  const initials = (user?.name ?? '?')
    .split(' ')
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  const sidebar = (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-16 items-center gap-2.5 border-b border-slate-100 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-700 text-white">
          <Activity className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">Monitoring Stok</p>
          <p className="truncate text-[10px] uppercase tracking-wide text-slate-400">Per Bagian · SIMDONDAR</p>
        </div>
      </div>
      <NavItems onNavigate={() => setDrawer(false)} />
      <div className="border-t border-slate-100 px-4 py-3">
        <p className="text-[10px] text-slate-400">Versi 1.0 · {new Date().getFullYear()}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-100">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 lg:block">{sidebar}</aside>

      {drawer ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setDrawer(false)} />
          <div className="relative h-full w-72 max-w-[85vw] shadow-2xl">
            <button
              onClick={() => setDrawer(false)}
              className="absolute right-2 top-2 z-10 rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              aria-label="Tutup menu"
            >
              <X className="h-5 w-5" />
            </button>
            {sidebar}
          </div>
        </div>
      ) : null}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDrawer(true)}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
              aria-label="Buka menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="hidden sm:block">
              <p className="text-xs text-slate-400">Sistem Monitoring Stok dan Pemakaian</p>
              <p className="text-sm font-semibold text-slate-800">{user?.role.name}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2.5">
            {user?.allDepartments ? (
              <Badge tone="teal" className="hidden sm:inline-flex">Semua bagian</Badge>
            ) : (
              <Badge tone="blue" className="hidden sm:inline-flex">
                {user?.departmentIds.length ?? 0} bagian
              </Badge>
            )}
            <NotificationBell />
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenu((value) => !value)}
                className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-slate-100"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">
                  {initials}
                </span>
                <span className="hidden max-w-[140px] truncate text-left sm:block">
                  <span className="block truncate text-xs font-semibold text-slate-800">{user?.name}</span>
                  <span className="block truncate text-[10px] text-slate-500">@{user?.username}</span>
                </span>
                <ChevronDown className="h-4 w-4 text-slate-400" />
              </button>
              {menu ? (
                <div className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                  <div className="border-b border-slate-100 px-4 py-3">
                    <p className="truncate text-sm font-semibold text-slate-800">{user?.name}</p>
                    <p className="truncate text-xs text-slate-500">{user?.role.name}</p>
                  </div>
                  <button
                    onClick={() => {
                      setMenu(false);
                      setPasswordOpen(true);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <KeyRound className="h-4 w-4 text-slate-400" /> Ubah kata sandi
                  </button>
                  <button
                    onClick={() => void doLogout()}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-rose-600 hover:bg-rose-50"
                  >
                    <LogOut className="h-4 w-4" /> Keluar
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {user?.mustChangePassword ? (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 sm:px-6">
            <strong>Perhatian:</strong> Anda masih menggunakan kata sandi sementara. Segera ubah melalui menu pengguna.
          </div>
        ) : null}

        <main className="mx-auto w-full max-w-[1500px] px-4 py-5 sm:px-6 sm:py-6">{children}</main>
      </div>

      <ChangePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  );
}
