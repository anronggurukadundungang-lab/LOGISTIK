import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Download, FileBarChart, FileText, Filter, Printer } from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { formatDate, formatDateTime, formatNumber, monthStart, today } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { Department, Item, Meta, ReportData } from '../types';
import { ItemSelect, type ItemSearchResult } from '../components/ItemSelect';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Table,
  Td,
  Th,
} from '../components/ui';

interface ReportType {
  type: string;
  label: string;
}

export function ReportsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [types, setTypes] = useState<ReportType[]>([]);
  const [type, setType] = useState('consumptions');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [departmentId, setDepartmentId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [item, setItem] = useState<ItemSearchResult | null>(null);
  const [group, setGroup] = useState('');
  const [days, setDays] = useState('30');
  const [meta, setMeta] = useState<Meta | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const canExport = can('reports.export');

  useEffect(() => {
    api.get<{ items: ReportType[] }>('/reports/types').then((result) => setTypes(result.items)).catch(() => undefined);
    api.get<Meta>('/meta').then(setMeta).catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.get<ReportData>(`/reports/${type}`, {
        from: from || undefined,
        to: to || undefined,
        departmentId: departmentId || undefined,
        categoryId: categoryId || undefined,
        itemId: item?.id,
        group: group || undefined,
        days: days || undefined,
      });
      setReport(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membangun laporan.');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [type, from, to, departmentId, categoryId, item, group, days]);

  useEffect(() => {
    void load();
  }, [load]);

  const departments: Department[] = meta?.departments ?? [];
  const categories = (meta?.categories ?? []).filter((category) => category.is_active);

  const exportReport = async (format: 'xlsx' | 'pdf') => {
    try {
      await downloadFile(`/reports/${type}/export`, {
        format,
        from: from || undefined,
        to: to || undefined,
        departmentId: departmentId || undefined,
        categoryId: categoryId || undefined,
        itemId: item?.id,
        group: group || undefined,
        days: days || undefined,
      }, `laporan-${type}.${format}`);
      toast.success(`Laporan ${format.toUpperCase()} sedang diunduh.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengekspor laporan.');
    }
  };

  const formatValue = (value: unknown, valueType?: string): string => {
    if (value === null || value === undefined || value === '') return '-';
    if (valueType === 'date') return formatDate(String(value));
    if (valueType === 'qty' || valueType === 'number') return formatNumber(value);
    if (typeof value === 'number') return formatNumber(value);
    return String(value);
  };

  return (
    <>
      <PageHeader
        title="Laporan"
        subtitle="Bangun laporan operasional dan manajemen sesuai cakupan bagian Anda, lalu unduh dalam format Excel atau PDF."
        actions={
          canExport && report ? (
            <>
              <Button variant="outline" onClick={() => void exportReport('xlsx')} icon={<Download className="h-4 w-4" />}>Excel</Button>
              <Button variant="outline" onClick={() => void exportReport('pdf')} icon={<FileText className="h-4 w-4" />}>PDF</Button>
              <Button variant="outline" onClick={() => window.print()} icon={<Printer className="h-4 w-4" />}>Cetak</Button>
            </>
          ) : null
        }
      />

      <div className="grid gap-5 xl:grid-cols-[280px_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader title={<span className="inline-flex items-center gap-2"><FileBarChart className="h-4 w-4 text-slate-400" /> Jenis Laporan</span>} />
            <div className="max-h-[420px] overflow-y-auto p-2">
              {types.map((itemType) => (
                <button
                  key={itemType.type}
                  onClick={() => setType(itemType.type)}
                  className={`block w-full rounded-lg px-3 py-2 text-left text-xs font-medium transition ${
                    type === itemType.type ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {itemType.label}
                </button>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title={<span className="inline-flex items-center gap-2"><Filter className="h-4 w-4 text-slate-400" /> Filter</span>} />
            <div className="space-y-3 p-4">
              <Field label="Dari tanggal">
                <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
              </Field>
              <Field label="Sampai tanggal">
                <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
              </Field>
              <Field label="Bagian">
                <Select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
                  <option value="">Semua bagian saya</option>
                  {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                </Select>
              </Field>
              <Field label="Kategori">
                <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                  <option value="">Semua kategori</option>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </Select>
              </Field>
              <Field label="Barang" hint="Terutama untuk Kartu Stok.">
                <ItemSelect value={item} onChange={setItem} />
              </Field>
              <Field label="Pengelompokan waktu">
                <Select value={group} onChange={(event) => setGroup(event.target.value)}>
                  <option value="">Default laporan</option>
                  <option value="detail">Per transaksi</option>
                  <option value="day">Per hari</option>
                  <option value="month">Per bulan</option>
                </Select>
              </Field>
              <Field label="Rentang hari" hint="Untuk laporan keterlambatan/pengadaan.">
                <Input type="number" min="1" max="3650" value={days} onChange={(event) => setDays(event.target.value)} />
              </Field>
              <Button className="w-full" onClick={() => void load()} loading={loading} icon={<CalendarDays className="h-4 w-4" />}>Tampilkan</Button>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
          {loading && !report ? (
            <Card><Spinner /></Card>
          ) : report ? (
            <Card>
              <CardHeader
                title={report.title}
                subtitle={report.subtitle}
                action={<span className="text-[11px] text-slate-500">{formatDateTime(report.generatedAt)} · {report.generatedBy}</span>}
              />

              {report.filterLabels.length || report.summary.length ? (
                <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-3">
                  {report.filterLabels.length ? (
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {report.filterLabels.map((label) => (
                        <span key={label.label} className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] text-slate-600 ring-1 ring-slate-200">
                          <span className="text-slate-400">{label.label}:</span> <span className="font-medium">{label.value}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {report.summary.length ? (
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      {report.summary.map((summary) => (
                        <div key={summary.label} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <p className="text-[10px] uppercase tracking-wide text-slate-500">{summary.label}</p>
                          <p className="mt-0.5 text-sm font-semibold text-slate-800">
                            {typeof summary.value === 'number' ? formatNumber(summary.value) : summary.value}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {report.rows.length ? (
                <>
                  <Table>
                    <thead>
                      <tr>
                        {report.columns.map((column) => (
                          <Th key={column.key} align={column.type === 'qty' || column.type === 'number' ? 'right' : 'left'}>
                            {column.header}
                          </Th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.slice(0, 500).map((row, index) => (
                        <tr key={index} className="hover:bg-slate-50/60">
                          {report.columns.map((column) => (
                            <Td key={column.key} align={column.type === 'qty' || column.type === 'number' ? 'right' : 'left'} className="text-xs">
                              {formatValue(row[column.key], column.type)}
                            </Td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  {report.rows.length > 500 || report.truncated ? (
                    <div className="border-t border-slate-100 bg-amber-50 px-4 py-2.5 text-[11px] text-amber-800">
                      Menampilkan 500 baris pertama{report.truncated ? ' (laporan dipotong oleh server)' : ''}. Unduh Excel untuk data lengkap.
                    </div>
                  ) : null}
                </>
              ) : (
                <EmptyState title="Tidak ada data" description="Tidak ada baris yang cocok dengan filter laporan ini." />
              )}
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
