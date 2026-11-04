import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Boxes, Download, PackageOpen, Search, Warehouse } from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { formatDate, formatNumber } from '../lib/format';
import type { Category, Department, Meta, Paginated, StockRow } from '../types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Spinner,
  StatCard,
  Table,
  Td,
  Th,
} from '../components/ui';

interface StockSummary {
  row_count: number;
  total_qty: number;
  critical_count: number;
  low_count: number;
}

const statusInfo: Record<string, { label: string; tone: 'green' | 'yellow' | 'red' }> = {
  safe: { label: 'Aman', tone: 'green' },
  low: { label: 'Menipis', tone: 'yellow' },
  critical: { label: 'Habis', tone: 'red' },
};

export function StockPage() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [departmentId, setDepartmentId] = useState(params.get('departmentId') ?? '');
  const [categoryId, setCategoryId] = useState(params.get('categoryId') ?? '');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<StockRow> | null>(null);
  const [summary, setSummary] = useState<StockSummary | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Meta>('/meta').then(setMeta).catch(() => undefined);
    api
      .get<{ summary: StockSummary }>('/stocks/summary')
      .then((result) => setSummary(result.summary))
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.get<Paginated<StockRow>>('/stocks', {
        page,
        pageSize: 25,
        search,
        departmentId: departmentId || undefined,
        categoryId: categoryId || undefined,
        status: status || undefined,
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data stok.');
    } finally {
      setLoading(false);
    }
  }, [page, search, departmentId, categoryId, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (search) next.set('search', search);
    if (departmentId) next.set('departmentId', departmentId);
    if (categoryId) next.set('categoryId', categoryId);
    if (status) next.set('status', status);
    setParams(next, { replace: true });
  }, [search, departmentId, categoryId, status, setParams]);

  const departments: Department[] = meta?.departments ?? [];
  const categories: Category[] = (meta?.categories ?? []).filter((category) => category.is_active);

  return (
    <>
      <PageHeader
        title="Monitoring Stok"
        subtitle="Saldo stok per bagian yang dihitung langsung dari ledger transaksi. Klik kartu untuk melihat riwayat."
        actions={
          <Button
            variant="outline"
            icon={<Download className="h-4 w-4" />}
            onClick={() =>
              void downloadFile('/reports/stock-summary/export', {
                format: 'xlsx',
                departmentId: departmentId || undefined,
                categoryId: categoryId || undefined,
              }, 'stok-per-bagian.xlsx')
            }
          >
            Unduh Excel
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Baris stok" value={formatNumber(summary?.row_count)} sub="Kombinasi bagian & barang" icon={<Boxes className="h-5 w-5" />} />
        <StatCard label="Total saldo" value={formatNumber(summary?.total_qty)} sub="Seluruh satuan dasar" icon={<Warehouse className="h-5 w-5" />} tone="blue" />
        <StatCard
          label="Stok menipis"
          value={formatNumber(summary?.low_count)}
          sub="Di bawah atau sama dengan minimum"
          icon={<AlertTriangle className="h-5 w-5" />}
          tone="amber"
          onClick={() => setStatus('low')}
        />
        <StatCard
          label="Stok habis"
          value={formatNumber(summary?.critical_count)}
          sub="Saldo nol atau negatif"
          icon={<PackageOpen className="h-5 w-5" />}
          tone="rose"
          onClick={() => setStatus('critical')}
        />
      </div>

      <Card>
        <div className="grid gap-2.5 border-b border-slate-100 p-3 sm:grid-cols-2 xl:grid-cols-5">
          <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Cari nama atau kode barang..." className="xl:col-span-2" />
          <Select value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setPage(1); }}>
            <option value="">Semua bagian</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>{department.name}</option>
            ))}
          </Select>
          <Select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(1); }}>
            <option value="">Semua kategori</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </Select>
          <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="">Semua status</option>
            <option value="safe">Aman</option>
            <option value="low">Menipis</option>
            <option value="critical">Habis</option>
          </Select>
        </div>

        {error ? <div className="m-4 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{error}</div> : null}

        {loading && !data ? (
          <Spinner />
        ) : data && data.items.length ? (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Barang</Th>
                  <Th>Bagian</Th>
                  <Th>Kategori</Th>
                  <Th align="right">Saldo</Th>
                  <Th align="right">Minimum</Th>
                  <Th align="right">Masuk</Th>
                  <Th align="right">Pemakaian</Th>
                  <Th>Status</Th>
                  <Th align="right">Aksi</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => {
                  const info = statusInfo[row.stock_status] ?? statusInfo.safe;
                  return (
                    <tr key={`${row.department_id}-${row.item_id}`} className="hover:bg-slate-50/60">
                      <Td>
                        <p className="max-w-[240px] truncate font-medium text-slate-800">{row.item_name}</p>
                        <p className="text-[11px] text-slate-500">{row.item_code}</p>
                      </Td>
                      <Td className="text-xs">{row.department_name}</Td>
                      <Td className="text-xs text-slate-500">{row.category_name ?? '-'}</Td>
                      <Td align="right">
                        <span className={row.stock_status === 'critical' ? 'font-semibold text-rose-600' : row.stock_status === 'low' ? 'font-semibold text-amber-600' : 'font-semibold text-slate-800'}>
                          {formatNumber(row.qty)} <span className="text-[10px] font-normal text-slate-500">{row.unit_code}</span>
                        </span>
                      </Td>
                      <Td align="right" className="text-xs text-slate-500">{formatNumber(row.min_stock)}</Td>
                      <Td align="right" className="text-xs text-emerald-700">{formatNumber(row.received_total)}</Td>
                      <Td align="right" className="text-xs text-rose-600">{formatNumber(row.consumption_total)}</Td>
                      <Td>
                        <Badge tone={info.tone}>
                          {info.label}
                          {row.last_opname_date ? <span className="ml-1 font-normal opacity-70">· {formatDate(row.last_opname_date)}</span> : null}
                        </Badge>
                      </Td>
                      <Td align="right">
                        <Link
                          to={`/stok/kartu/${row.department_id}/${row.item_id}`}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
                        >
                          <Search className="h-3 w-3" /> Kartu
                        </Link>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} total={data.pagination.total} onChange={setPage} />
          </>
        ) : (
          <EmptyState
            title="Tidak ada data stok"
            description="Belum ada stok yang cocok dengan filter. Stok akan muncul setelah penerimaan SIMDONDAR dikonfirmasi."
          />
        )}
      </Card>
    </>
  );
}
