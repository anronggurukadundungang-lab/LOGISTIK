import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Loader2, ShieldAlert } from 'lucide-react';
import { useAuth } from './context/AuthContext';
import { Layout } from './components/Layout';
import { Button, Card, PageHeader } from './components/ui';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { StockPage } from './pages/Stock';
import { StockCardPage } from './pages/StockCard';
import { ReceiptsPage } from './pages/Receipts';
import { ConsumptionPage } from './pages/Consumption';
import { OpnamesPage } from './pages/Opnames';
import { OpnameDetailPage } from './pages/OpnameDetail';
import { ApprovalsPage } from './pages/Approvals';
import { ImportsPage } from './pages/Imports';
import { ImportDetailPage } from './pages/ImportDetail';
import { ItemsPage } from './pages/Items';
import { DepartmentsPage } from './pages/Departments';
import { UsersPage } from './pages/Users';
import { ReportsPage } from './pages/Reports';
import { AuditPage } from './pages/Audit';
import { SettingsPage } from './pages/Settings';
import { Link } from 'react-router-dom';

function Splash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-100">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-700 text-white">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
      <p className="text-sm font-medium text-slate-600">Memuat sistem monitoring stok...</p>
    </div>
  );
}

function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

function Guard({ any, all, children }: { any?: string[]; all?: string[]; children: React.ReactNode }) {
  const { canAny, can } = useAuth();
  const allowed = (any ? canAny(...any) : true) && (all ? all.every(can) : true);
  if (!allowed) return <Forbidden />;
  return <>{children}</>;
}

function Forbidden() {
  return (
    <>
      <PageHeader title="Akses ditolak" subtitle="Akun Anda tidak memiliki kewenangan untuk membuka halaman ini." />
      <Card className="p-8">
        <div className="mx-auto flex max-w-md flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <p className="text-sm font-medium text-slate-800">Kewenangan tidak mencukupi</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Hubungi administrator bila Anda memerlukan akses ke halaman ini. Setiap percobaan akses tetap tercatat pada sistem.
          </p>
          <Link to="/" className="mt-4"><Button variant="outline">Kembali ke Dashboard</Button></Link>
        </div>
      </Card>
    </>
  );
}

function NotFound() {
  return (
    <>
      <PageHeader title="Halaman tidak ditemukan" subtitle="Alamat yang Anda buka tidak tersedia atau sudah dipindahkan." />
      <Card className="p-8 text-center">
        <p className="text-4xl font-semibold text-slate-300">404</p>
        <p className="mt-2 text-sm text-slate-600">Periksa kembali alamat halaman.</p>
        <Link to="/" className="mt-4 inline-block"><Button>Kembali ke Dashboard</Button></Link>
      </Card>
    </>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<Guard all={['dashboard.view']}><DashboardPage /></Guard>} />
        <Route path="/stok" element={<Guard all={['stocks.view']}><StockPage /></Guard>} />
        <Route path="/stok/kartu/:departmentId/:itemId" element={<Guard all={['stocks.view']}><StockCardPage /></Guard>} />
        <Route path="/pemakaian" element={<Guard any={['consumptions.create', 'stocks.view']}><ConsumptionPage /></Guard>} />
        <Route path="/penerimaan" element={<Guard all={['receipts.confirm']}><ReceiptsPage /></Guard>} />
        <Route path="/opname" element={<Guard any={['approvals.view', 'opnames.create']}><OpnamesPage /></Guard>} />
        <Route path="/opname/:id" element={<Guard any={['approvals.view', 'opnames.create']}><OpnameDetailPage /></Guard>} />
        <Route path="/persetujuan" element={<Guard all={['approvals.view']}><ApprovalsPage /></Guard>} />
        <Route path="/impor" element={<Guard all={['imports.view']}><ImportsPage /></Guard>} />
        <Route path="/impor/:id" element={<Guard all={['imports.view']}><ImportDetailPage /></Guard>} />
        <Route path="/barang" element={<Guard all={['items.view']}><ItemsPage /></Guard>} />
        <Route path="/bagian" element={<Guard all={['departments.view']}><DepartmentsPage /></Guard>} />
        <Route path="/pengguna" element={<Guard all={['users.manage']}><UsersPage /></Guard>} />
        <Route path="/laporan" element={<Guard all={['reports.view']}><ReportsPage /></Guard>} />
        <Route path="/audit" element={<Guard all={['audit.view']}><AuditPage /></Guard>} />
        <Route path="/pengaturan" element={<Guard all={['settings.manage']}><SettingsPage /></Guard>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
