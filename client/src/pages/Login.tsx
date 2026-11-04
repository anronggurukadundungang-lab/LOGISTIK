import { useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2, Lock, ShieldCheck, User as UserIcon } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button, Field, Input } from '../components/ui';

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = 'Masuk · Monitoring Stok Per Bagian';
  }, []);

  useEffect(() => {
    if (!loading && user) {
      const target = (location.state as { from?: string } | null)?.from ?? '/';
      navigate(target, { replace: true });
    }
  }, [loading, user, navigate, location.state]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tidak dapat masuk. Coba lagi.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-100">
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-800 via-brand-700 to-teal-900 p-10 text-white lg:flex">
        <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-emerald-300/10 blur-3xl" />
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-wide">SIMDONDAR Companion</p>
              <p className="text-xs text-white/60">Monitoring Stok &amp; Pemakaian</p>
            </div>
          </div>
        </div>
        <div className="relative max-w-lg">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">
            Stok akurat, pemakaian terkendali, keputusan lebih cepat.
          </h1>
          <p className="mt-5 text-sm leading-6 text-white/70">
            Pantau saldo dan pemakaian barang per bagian, catat penerimaan dari SIMDONDAR, dan lakukan
            stok opname dengan alur persetujuan yang tertelusur.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-3 text-center">
            {[
              ['23', 'Bagian'],
              ['12+', 'Jenis laporan'],
              ['100%', 'Jejak audit'],
            ].map(([value, label]) => (
              <div key={label} className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                <p className="text-xl font-semibold">{value}</p>
                <p className="mt-0.5 text-[11px] text-white/60">{label}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-xs text-white/50">
          Sistem pendamping SIMDONDAR · Data stok dikelola secara append-only
        </p>
      </div>

      <div className="flex w-full items-center justify-center px-4 py-10 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-700 text-white">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Monitoring Stok</p>
              <p className="text-[11px] text-slate-500">Per Bagian · SIMDONDAR</p>
            </div>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Masuk ke sistem</h2>
          <p className="mt-1.5 text-sm text-slate-500">Gunakan akun yang diberikan oleh administrator.</p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            <Field label="Nama pengguna" required>
              <div className="relative">
                <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="contoh: admin"
                  autoComplete="username"
                  autoFocus
                  className="pl-9"
                />
              </div>
            </Field>
            <Field label="Kata sandi" required>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Masukkan kata sandi"
                  autoComplete="current-password"
                  className="pl-9 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-400 hover:bg-slate-100"
                  aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>

            {error ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs leading-5 text-rose-700">
                {error}
              </div>
            ) : null}

            <Button type="submit" size="lg" className="w-full" disabled={!username || !password} loading={submitting || loading}>
              {submitting ? 'Memeriksa...' : 'Masuk'}
            </Button>
          </form>

          <div className="mt-8 rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs leading-5 text-slate-500">
            <p className="font-medium text-slate-700">Akses terbatas</p>
            <p className="mt-0.5">
              Setiap bagian hanya dapat melihat data sesuai kewenangannya. Aktivitas masuk dan perubahan data dicatat
              dalam audit trail.
            </p>
          </div>
          {loading ? (
            <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memeriksa sesi...
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
