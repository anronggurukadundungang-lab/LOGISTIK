import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download, History, PackageMinus, ShoppingCart } from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { entryLabel, formatDate, formatNumber } from '../lib/format';
import type { Paginated, StockEntry, StockRow } from '../types';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Pagination,
  Spinner,
  StatusBadge,
  Table,
  Td,
  Th,
} from '../components/ui';

export function StockCardPage() {
  const { departmentId, itemId } = useParams();
  const [stock, setStock] = useState<StockRow | null>(null);
  const [entries, setEntries] = useState<Paginated<StockEntry> | null>(null);
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [error, setError] = useState('');

  const loadStock = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.get<Paginated<StockRow>>('/stocks', { departmentId, itemId, pageSize: 1 });
      setStock(result.items[0] ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat kartu stok.');
    } finally {
      setLoading(false);
    }
  }, [departmentId, itemId]);

  const loadEntries = useCallback(async () => {
    setEntriesLoading(true);
    try {
      const result = await api.get<Paginated<StockEntry>>('/stock-entries', {
        departmentId,
        itemId,
        page,
        pageSize: 30,
        from: from || undefined,
        to: to || undefined,
      });
      setEntries(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat riwayat.');
    } finally {
      setEntriesLoading(false);
    }
  }, [departmentId, itemId, page, from, to]);

  useEffect(() => {
    void loadStock();
  }, [loadStock]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    setPage(1);
  }, [departmentId, itemId, from, to]);

  if (loading) return <Spinner />;

  if (!stock) {
    return (
      <>
        <PageHeader title="Kartu Stok" />
        <Card>
          <EmptyState title="Kartu stok tidak ditemukan" description={error || 'Barang belum memiliki saldo pada bagian ini.'} action={<Link to="/stok"><Button variant="outline">Kembali ke Monitoring</Button></Link>} />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Kartu Stok"
        subtitle={
          <>
            <span className="font-medium text-slate-700">{stock.item_name}</span> · {stock.item_code} · {stock.department_name}
          </>
        }
        actions={
          <>
            <Link to="/stok">
              <Button variant="outline" size="sm" icon={<ArrowLeft className="h-4 w-4" />}>Kembali</Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              icon={<Download className="h-4 w-4" />}
              onClick={() =>
                void downloadFile('/reports/stock-card/export', {
                  format: 'xlsx',
                  departmentId,
                  itemId,
                  from: from || undefined,
                  to: to || undefined,
                }, 'kartu-stok.xlsx')
              }
            >
              Ekspor Excel
            </Button>
            <Link to={`/pemakaian?departmentId=${departmentId}&itemId=${itemId}`}>
              <Button size="sm" icon={<ShoppingCart className="h-4 w-4" />}>Catat Pemakaian</Button>
            </Link>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Saldo saat ini</p>
          <p className="mt-1.5 text-2xl font-semibold text-slate-900">
            {formatNumber(stock.qty)} <span className="text-sm font-normal text-slate-500">{stock.unit_code}</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">Minimum {formatNumber(stock.min_stock)} {stock.unit_code}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total masuk</p>
          <p className="mt-1.5 text-2xl font-semibold text-emerald-700">{formatNumber(stock.received_total)}</p>
          <p className="mt-1 text-xs text-slate-500">Penerimaan &amp; saldo awal</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total pemakaian</p>
          <p className="mt-1.5 text-2xl font-semibold text-rose-600">{formatNumber(stock.consumption_total)}</p>
          <p className="mt-1 text-xs text-slate-500">{formatNumber(stock.return_total)} retur · {formatNumber(stock.damage_total)} rusak/hilang</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Opname terakhir</p>
          <p className="mt-1.5 text-lg font-semibold text-slate-900">{formatDate(stock.last_opname_date)}</p>
          <p className="mt-1 text-xs text-slate-500">
            Fisik {stock.physical_qty === null ? '-' : formatNumber(stock.physical_qty)} · Selisih{' '}
            {stock.opname_difference === null ? '-' : formatNumber(stock.opname_difference)}
          </p>
        </Card>
      </div>

      <Card>
        <CardHeader
          title={<span className="inline-flex items-center gap-2"><History className="h-4 w-4 text-slate-400" /> Riwayat Ledger</span>}
          subtitle="Setiap perubahan saldo berasal dari transaksi yang tidak dapat diubah. Pembalik dan koreksi tampil sebagai transaksi tersendiri."
          action={
            <div className="flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="mb-1 block text-[10px] text-slate-500">Dari</span>
                <input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} className="h-8 rounded-md border border-slate-300 px-2 text-xs" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] text-slate-500">Sampai</span>
                <input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} className="h-8 rounded-md border border-slate-300 px-2 text-xs" />
              </label>
            </div>
          }
        />
        {entriesLoading && !entries ? (
          <Spinner />
        ) : entries && entries.items.length ? (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Tanggal</Th>
                  <Th>No. Transaksi</Th>
                  <Th>Jenis</Th>
                  <Th>Keterangan</Th>
                  <Th align="right">Masuk</Th>
                  <Th align="right">Keluar</Th>
                  <Th align="right">Saldo</Th>
                  <Th>Dicatat oleh</Th>
                </tr>
              </thead>
              <tbody>
                {entries.items.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50/60">
                    <Td className="whitespace-nowrap text-xs">{formatDate(entry.occurred_at)}</Td>
                    <Td><span className="font-mono text-[11px] text-slate-600">{entry.entry_no}</span></Td>
                    <Td><StatusBadge status={entry.entry_type} label={entryLabel(entry.entry_type)} /></Td>
                    <Td>
                      <p className="max-w-[280px] truncate text-xs text-slate-700">{entry.description || entry.reason || '-'}</p>
                      <p className="text-[10px] text-slate-400">
                        {entry.source_doc_number ? `Dok. ${entry.source_doc_number}` : ''}
                        {entry.reversed_entry_no ? `Pembalik ${entry.reversed_entry_no}` : ''}
                      </p>
                    </Td>
                    <Td align="right" className="text-xs font-medium text-emerald-700">
                      {entry.qty_delta > 0 ? formatNumber(entry.qty_delta) : '-'}
                    </Td>
                    <Td align="right" className="text-xs font-medium text-rose-600">
                      {entry.qty_delta < 0 ? formatNumber(Math.abs(entry.qty_delta)) : '-'}
                    </Td>
                    <Td align="right" className="font-semibold">{formatNumber(entry.balance_after)}</Td>
                    <Td className="text-[11px] text-slate-500">{entry.created_by_name}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={entries.pagination.page} totalPages={entries.pagination.totalPages} total={entries.pagination.total} onChange={setPage} />
          </>
        ) : (
          <EmptyState title="Belum ada transaksi" description="Belum ada mutasi stok untuk barang ini pada rentang tanggal terpilih." />
        )}
      </Card>
    </>
  );
}
