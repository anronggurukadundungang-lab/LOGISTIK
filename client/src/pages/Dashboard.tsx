import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  FileSpreadsheet,
  PackageCheck,
  RefreshCw,
  ShoppingCart,
  TrendingUp,
  Warehouse,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { formatDate, formatDateTime, formatNumber, monthStart, statusLabel, today } from '../lib/format';
import type { Category, Department, Meta } from '../types';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Select,
  Spinner,
  StatCard,
  StatusBadge,
  Table,
  Td,
  Th,
} from '../components/ui';

interface DashboardData {
  empty?: boolean;
  message?: string;
  filters: { from: string; to: string; departmentId: number | null; categoryId: number | null; itemId: number | null };
  cards: Record<string, number | boolean>;
  charts: {
    trend: Array<{ period: string; qty: number }>;
    topItems: Array<{ id: number; item_name: string; item_code: string; unit_code: string; qty: number }>;
    stockByDepartment: Array<{ id: number; department_name: string; qty: number }>;
    issuesByDepartment: Array<{ id: number; department_name: string; qty: number }>;
  };
  tables: {
    lowStock: Array<{
      qty: number;
      item_name: string;
      item_code: string;
      min_stock: number;
      unit_code: string;
      department_name: string;
      department_id: number;
      item_id: number;
    }>;
    lateInput: Array<{ id: number; department_name: string; last_input: string | null; receipt_count: number }>;
    opnames: Array<{
      id: number;
      opname_date: string;
      status: string;
      department_name: string;
      diff_count: number;
      diff_qty: number;
    }>;
    pending: Array<{
      id: number;
      type: string;
      summary: string;
      created_at: string;
      status: string;
      department_name: string;
      requester_name: string;
    }>;
    recentImports: Array<{
      id: number;
      filename: string;
      status: string;
      total_rows: number;
      imported_rows: number;
      error_rows: number;
      duplicate_rows: number;
      created_at: string;
      created_by_name: string;
    }>;
    recentEntries: Array<{
      id: number;
      entry_no: string;
      entry_type: string;
      qty_delta: number;
      occurred_at: string;
      balance_after: number;
      item_name: string;
      unit_code: string;
      department_name: string;
      created_by_name: string;
    }>;
  };
}

const TYPE_LABELS: Record<string, string> = {
  DAMAGE: 'Rusak',
  LOSS: 'Hilang',
  EXPIRED: 'Kedaluwarsa',
  ADJUSTMENT: 'Penyesuaian',
  CORRECTION: 'Koreksi Pemakaian',
  OPNAME: 'Stok Opname',
};

export function DashboardPage() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [departmentId, setDepartmentId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [data, setData] = useState<DashboardData | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.get<DashboardData>('/dashboard', {
        from,
        to,
        departmentId: departmentId || undefined,
        categoryId: categoryId || undefined,
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat dashboard.');
    } finally {
      setLoading(false);
    }
  }, [from, to, departmentId, categoryId]);

  useEffect(() => {
    api.get<Meta>('/meta').then(setMeta).catch(() => undefined);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const departments: Department[] = meta?.departments ?? [];
  const categories: Category[] = useMemo(
    () => (meta?.categories ?? []).filter((category) => category.is_active),
    [meta],
  );

  const cards = data?.cards ?? {};

  if (data?.empty) {
    return (
      <>
        <PageHeader title="Dashboard" subtitle="Ringkasan stok dan pemakaian sesuai cakupan Anda." />
        <Card>
          <EmptyState
            title="Belum ada bagian yang ditugaskan"
            description={data.message ?? 'Hubungi administrator untuk menetapkan bagian pada akun Anda.'}
          />
        </Card>
      </>
    );
  }

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 11) return 'Selamat pagi';
    if (hour < 15) return 'Selamat siang';
    if (hour < 19) return 'Selamat sore';
    return 'Selamat malam';
  })();

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`${greeting}, ${user?.name ?? ''}. Ringkasan ${formatDate(from)} – ${formatDate(to)}.${
          cards.scope_all === false ? ' Data dibatasi pada bagian yang menjadi kewenangan Anda.' : ''
        }`}
        actions={
          <Button variant="outline" onClick={() => void load()} loading={loading} icon={<RefreshCw className="h-4 w-4" />}>
            Muat ulang
          </Button>
        }
      />

      <Card className="mb-5">
        <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-slate-500">Dari tanggal</span>
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-slate-500">Sampai tanggal</span>
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-slate-500">Bagian</span>
            <Select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className="h-9">
              <option value="">Semua bagian</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-slate-500">Kategori</span>
            <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="h-9">
              <option value="">Semua kategori</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </Select>
          </label>
        </div>
      </Card>

      {error ? (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      {loading && !data ? (
        <Spinner />
      ) : data ? (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Total saldo stok"
              value={formatNumber(cards.total_stock)}
              sub={`${formatNumber(cards.active_items)} barang aktif · ${formatNumber(cards.department_count)} bagian`}
              icon={<Warehouse className="h-5 w-5" />}
              tone="teal"
              onClick={() => navigate('/stok')}
            />
            <StatCard
              label="Pemakaian periode"
              value={formatNumber(cards.consumption_qty)}
              sub={`${formatNumber(cards.consumption_trx)} transaksi pemakaian`}
              icon={<ShoppingCart className="h-5 w-5" />}
              tone="blue"
              onClick={() => navigate('/pemakaian')}
            />
            <StatCard
              label="Stok menipis / habis"
              value={`${formatNumber(cards.low_stock_count)} / ${formatNumber(cards.critical_stock_count)}`}
              sub="Baris di bawah minimum / saldo nol"
              icon={<AlertTriangle className="h-5 w-5" />}
              tone="amber"
              onClick={() => navigate('/stok?status=low')}
            />
            <StatCard
              label="Menunggu tindakan"
              value={`${formatNumber(cards.pending_approvals)} / ${formatNumber(cards.awaiting_receipts)}`}
              sub="Persetujuan / penerimaan belum dikonfirmasi"
              icon={<ClipboardList className="h-5 w-5" />}
              tone="violet"
              onClick={() => navigate(can('approvals.view') ? '/persetujuan' : '/penerimaan')}
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader
                title="Tren pemakaian"
                subtitle="Jumlah barang yang dipakai pada periode terpilih."
                action={<Badge tone="teal"><TrendingUp className="mr-1 h-3 w-3" /> {formatNumber(cards.consumption_qty)} unit</Badge>}
              />
              <div className="h-64 px-2 py-4">
                {data.charts.trend.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.charts.trend} margin={{ top: 5, right: 15, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0d9488" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#0d9488" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="period" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} width={44} />
                      <Tooltip
                        formatter={(value: unknown) => [formatNumber(value), 'Pemakaian']}
                        labelStyle={{ fontSize: 12 }}
                        contentStyle={{ borderRadius: 8, borderColor: '#e2e8f0', fontSize: 12 }}
                      />
                      <Area type="monotone" dataKey="qty" stroke="#0d9488" strokeWidth={2} fill="url(#trendFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState compact title="Belum ada pemakaian" description="Tidak ada transaksi pemakaian pada periode ini." />
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title="Stok per bagian" subtitle="Saldo stok seluruh barang pada setiap bagian." />
              <div className="h-64 px-2 py-4">
                {data.charts.stockByDepartment.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.charts.stockByDepartment} layout="vertical" margin={{ top: 0, right: 15, left: 4, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="department_name" width={110} tick={{ fontSize: 10, fill: '#475569' }} tickLine={false} axisLine={false} />
                      <Tooltip formatter={(value: unknown) => [formatNumber(value), 'Stok']} contentStyle={{ borderRadius: 8, borderColor: '#e2e8f0', fontSize: 12 }} />
                      <Bar dataKey="qty" fill="#0f766e" radius={[0, 4, 4, 0]} barSize={12} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState compact title="Belum ada saldo" />
                )}
              </div>
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader
                title="Barang paling banyak dipakai"
                subtitle="8 barang dengan pemakaian tertinggi pada periode ini."
              />
              {data.charts.topItems.length ? (
                <div className="space-y-3 p-4">
                  {data.charts.topItems.map((item, index) => {
                    const max = Math.max(...data.charts.topItems.map((row) => Number(row.qty)), 1);
                    return (
                      <div key={item.id}>
                        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                          <span className="truncate text-slate-700">
                            <span className="mr-1.5 text-slate-400">{index + 1}.</span>
                            {item.item_name}
                          </span>
                          <span className="shrink-0 font-medium tabular-nums text-slate-800">
                            {formatNumber(item.qty)} {item.unit_code}
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.max(4, (Number(item.qty) / max) * 100)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState compact title="Belum ada pemakaian" />
              )}
            </Card>

            <Card>
              <CardHeader
                title="Stok menipis"
                subtitle="Barang yang saldonya berada pada atau di bawah minimum."
                action={<Link to="/stok?status=low" className="text-xs font-medium text-brand-700 hover:underline">Lihat semua</Link>}
              />
              {data.tables.lowStock.length ? (
                <Table>
                  <thead>
                    <tr>
                      <Th>Barang</Th>
                      <Th>Bagian</Th>
                      <Th align="right">Saldo</Th>
                      <Th align="right">Min.</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.tables.lowStock.slice(0, 8).map((row) => (
                      <tr key={`${row.department_id}-${row.item_id}`}>
                        <Td>
                          <p className="max-w-[180px] truncate font-medium text-slate-800">{row.item_name}</p>
                          <p className="text-[11px] text-slate-500">{row.item_code}</p>
                        </Td>
                        <Td className="text-xs">{row.department_name}</Td>
                        <Td align="right">
                          <span className={Number(row.qty) <= 0 ? 'font-semibold text-rose-600' : 'font-semibold text-amber-600'}>
                            {formatNumber(row.qty)} {row.unit_code}
                          </span>
                        </Td>
                        <Td align="right" className="text-xs text-slate-500">{formatNumber(row.min_stock)}</Td>
                        <Td align="right">
                          <Link
                            to={`/stok/kartu/${row.department_id}/${row.item_id}`}
                            className="text-xs font-medium text-brand-700 hover:underline"
                          >
                            Kartu
                          </Link>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <EmptyState compact title="Semua stok aman" description="Tidak ada barang di bawah batas minimum." />
              )}
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader
                title="Persetujuan menunggu"
                subtitle="Pengajuan yang memerlukan keputusan."
                action={<Link to="/persetujuan" className="text-xs font-medium text-brand-700 hover:underline">Buka antrean</Link>}
              />
              {data.tables.pending.length ? (
                <Table>
                  <thead>
                    <tr>
                      <Th>Pengajuan</Th>
                      <Th>Bagian</Th>
                      <Th>Pemohon</Th>
                      <Th align="right">Tanggal</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tables.pending.map((row) => (
                      <tr key={row.id}>
                        <Td>
                          <Badge tone="yellow">{TYPE_LABELS[row.type] ?? row.type}</Badge>
                          <p className="mt-1 max-w-[260px] truncate text-xs text-slate-600">{row.summary}</p>
                        </Td>
                        <Td className="text-xs">{row.department_name}</Td>
                        <Td className="text-xs">{row.requester_name}</Td>
                        <Td align="right" className="text-[11px] text-slate-500">{formatDate(row.created_at)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <EmptyState compact title="Tidak ada pengajuan" description="Semua pengajuan sudah diproses." />
              )}
            </Card>

            <Card>
              <CardHeader
                title="Aktivitas stok terbaru"
                subtitle="Delapan transaksi ledger terakhir."
                action={<Link to="/stok" className="text-xs font-medium text-brand-700 hover:underline">Monitoring</Link>}
              />
              {data.tables.recentEntries.length ? (
                <Table>
                  <thead>
                    <tr>
                      <Th>Transaksi</Th>
                      <Th>Barang</Th>
                      <Th align="right">Qty</Th>
                      <Th align="right">Saldo</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tables.recentEntries.map((row) => (
                      <tr key={row.id}>
                        <Td>
                          <p className="font-mono text-[11px] text-slate-600">{row.entry_no}</p>
                          <p className="text-[11px] text-slate-500">{row.entry_type === 'RECEIPT' ? 'Penerimaan' : row.entry_type === 'CONSUMPTION' ? 'Pemakaian' : row.entry_type}</p>
                        </Td>
                        <Td>
                          <p className="max-w-[170px] truncate text-xs font-medium text-slate-700">{row.item_name}</p>
                          <p className="text-[11px] text-slate-500">{row.department_name}</p>
                        </Td>
                        <Td align="right">
                          <span className={row.qty_delta < 0 ? 'text-rose-600' : 'text-emerald-600'}>
                            {row.qty_delta > 0 ? '+' : ''}{formatNumber(row.qty_delta)} {row.unit_code}
                          </span>
                        </Td>
                        <Td align="right" className="font-medium">{formatNumber(row.balance_after)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <EmptyState compact title="Belum ada transaksi" />
              )}
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader title="Stok opname terakhir" subtitle="Ringkasan sesi opname yang sudah diajukan." />
              {data.tables.opnames.length ? (
                <div className="divide-y divide-slate-100">
                  {data.tables.opnames.map((row) => (
                    <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">{row.department_name}</p>
                        <p className="text-[11px] text-slate-500">
                          {formatDate(row.opname_date)} · {row.diff_count} item selisih · {formatNumber(row.diff_qty)} qty
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={row.status} />
                        <Link to={`/opname/${row.id}`} className="text-xs font-medium text-brand-700 hover:underline">Detail</Link>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState compact title="Belum ada opname" description="Sesi opname yang diajukan akan tampil di sini." />
              )}
            </Card>

            <Card>
              <CardHeader
                title="Keterlambatan input pemakaian"
                subtitle="Bagian dengan pencatatan pemakaian paling lama."
              />
              {data.tables.lateInput.length ? (
                <Table>
                  <thead>
                    <tr>
                      <Th>Bagian</Th>
                      <Th>Input terakhir</Th>
                      <Th align="right">Penerimaan periode</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tables.lateInput.slice(0, 8).map((row) => (
                      <tr key={row.id}>
                        <Td className="text-xs font-medium text-slate-700">{row.department_name}</Td>
                        <Td className="text-xs">
                          {row.last_input ? (
                            <span className="inline-flex items-center gap-1 text-slate-600">
                              <ArrowDownRight className="h-3 w-3 text-amber-500" /> {formatDate(row.last_input)}
                            </span>
                          ) : (
                            <span className="text-rose-600">Belum pernah</span>
                          )}
                        </Td>
                        <Td align="right" className="text-xs">{formatNumber(row.receipt_count)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <EmptyState compact title="Belum ada data" />
              )}
            </Card>
          </div>

          {can('imports.view') && data.tables.recentImports.length ? (
            <Card>
              <CardHeader
                title="Impor SIMDONDAR terbaru"
                subtitle="Riwayat unggah dan hasil pemrosesan berkas."
                action={<Link to="/impor" className="text-xs font-medium text-brand-700 hover:underline">Riwayat impor</Link>}
              />
              <Table>
                <thead>
                  <tr>
                    <Th>Berkas</Th>
                    <Th>Status</Th>
                    <Th align="right">Baris</Th>
                    <Th align="right">Terimpor</Th>
                    <Th align="right">Gagal</Th>
                    <Th>Diunggah</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.tables.recentImports.map((row) => (
                    <tr key={row.id}>
                      <Td>
                        <Link to={`/impor/${row.id}`} className="flex items-center gap-2 text-xs font-medium text-brand-700 hover:underline">
                          <FileSpreadsheet className="h-3.5 w-3.5" /> {row.filename}
                        </Link>
                        <p className="text-[11px] text-slate-500">{row.created_by_name}</p>
                      </Td>
                      <Td><StatusBadge status={row.status} /></Td>
                      <Td align="right" className="text-xs">{formatNumber(row.total_rows)}</Td>
                      <Td align="right" className="text-xs">{formatNumber(row.imported_rows)}</Td>
                      <Td align="right" className="text-xs">{formatNumber(row.error_rows)}</Td>
                      <Td className="text-[11px] text-slate-500">{formatDateTime(row.created_at)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { to: '/pemakaian', label: 'Catat pemakaian', icon: <ShoppingCart className="h-4 w-4" />, show: can('consumptions.create') },
              { to: '/penerimaan', label: 'Konfirmasi penerimaan', icon: <PackageCheck className="h-4 w-4" />, show: can('receipts.confirm') },
              { to: '/opname', label: 'Mulai stok opname', icon: <ClipboardCheck className="h-4 w-4" />, show: can('opnames.create') },
              { to: '/laporan', label: 'Buka laporan', icon: <FileSpreadsheet className="h-4 w-4" />, show: can('reports.view') },
            ]
              .filter((item) => item.show)
              .map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:border-brand-300 hover:text-brand-800"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700">{item.icon}</span>
                  {item.label}
                  <ArrowUpRight className="ml-auto h-4 w-4 text-slate-400" />
                </Link>
              ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
