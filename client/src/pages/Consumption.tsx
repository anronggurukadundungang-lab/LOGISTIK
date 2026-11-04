import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowDownToLine,
  ClipboardList,
  History,
  Plus,
  RotateCcw,
  ShoppingCart,
  Trash2,
  TriangleAlert,
  Undo2,
  Wrench,
} from 'lucide-react';
import { api } from '../lib/api';
import { formatDate, formatDateTime, formatNumber, today } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { Department, Item, Meta } from '../types';
import { ItemSelect, type ItemSearchResult } from '../components/ItemSelect';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  InfoBanner,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Table,
  Tabs,
  Td,
  Textarea,
  Th,
} from '../components/ui';

interface Conversion {
  id: number;
  item_id: number;
  from_unit_id: number;
  factor: number;
  unit_code: string;
  unit_name: string;
}

interface Line {
  key: number;
  item: ItemSearchResult | null;
  stock: number | null;
  conversions: Conversion[];
  unitId: number | '';
  qty: string;
  notes: string;
  loading: boolean;
}

interface RecentConsumption {
  id: number;
  entry_no: string;
  occurred_at: string;
  qty_delta: number;
  balance_after: number;
  item_name: string;
  unit_code: string;
  department_name: string;
  created_by_name: string;
  activity_category: string | null;
  officer_name: string | null;
}

type ActionKind = 'RETURN' | 'DAMAGE' | 'LOSS' | 'EXPIRED' | 'ADJUSTMENT';

const ACTION_META: Record<ActionKind, { title: string; description: string; button: string; tone: 'primary' | 'danger' }> = {
  RETURN: {
    title: 'Catat Retur ke Logistik',
    description: 'Barang dikembalikan ke Logistik. Retur langsung mengurangi saldo bagian dan tidak memerlukan persetujuan.',
    button: 'Simpan Retur',
    tone: 'primary',
  },
  DAMAGE: {
    title: 'Ajukan Barang Rusak',
    description: 'Pengajuan barang rusak memerlukan persetujuan. Saldo baru berkurang setelah disetujui.',
    button: 'Ajukan',
    tone: 'danger',
  },
  LOSS: {
    title: 'Ajukan Barang Hilang',
    description: 'Pengajuan barang hilang memerlukan persetujuan dan alasan yang jelas.',
    button: 'Ajukan',
    tone: 'danger',
  },
  EXPIRED: {
    title: 'Ajukan Barang Kedaluwarsa',
    description: 'Pengajuan barang kedaluwarsa memerlukan persetujuan sebelum saldo dikurangi.',
    button: 'Ajukan',
    tone: 'danger',
  },
  ADJUSTMENT: {
    title: 'Ajukan Penyesuaian Stok',
    description: 'Gunakan untuk koreksi saldo non-transaksional. Perubahan saldo hanya terjadi setelah disetujui.',
    button: 'Ajukan',
    tone: 'primary',
  },
};

let lineCounter = 1;
function newLine(): Line {
  return { key: lineCounter++, item: null, stock: null, conversions: [], unitId: '', qty: '', notes: '', loading: false };
}

export function ConsumptionPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const [tab, setTab] = useState('entry');
  const [meta, setMeta] = useState<Meta | null>(null);
  const [departmentId, setDepartmentId] = useState(params.get('departmentId') ?? '');
  const [occurredAt, setOccurredAt] = useState(today());
  const [activityCategory, setActivityCategory] = useState('');
  const [officerName, setOfficerName] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [recent, setRecent] = useState<RecentConsumption[]>([]);
  const [recentDept, setRecentDept] = useState('');
  const [recentLoading, setRecentLoading] = useState(false);
  const [correction, setCorrection] = useState<RecentConsumption | null>(null);
  const [newQty, setNewQty] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionSaving, setCorrectionSaving] = useState(false);
  const [correctionError, setCorrectionError] = useState('');

  const [action, setAction] = useState<ActionKind | null>(null);
  const [actionItem, setActionItem] = useState<ItemSearchResult | null>(null);
  const [actionStock, setActionStock] = useState<number | null>(null);
  const [actionQty, setActionQty] = useState('');
  const [actionDate, setActionDate] = useState(today());
  const [actionNotes, setActionNotes] = useState('');
  const [actionReason, setActionReason] = useState('');
  const [actionDestination, setActionDestination] = useState('');
  const [actionSaving, setActionSaving] = useState(false);
  const [actionError, setActionError] = useState('');

  const presetApplied = useRef(false);

  useEffect(() => {
    api.get<Meta>('/meta').then((result) => {
      setMeta(result);
      if (!departmentId && result.departments.length) setDepartmentId(String(result.departments[0].id));
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const departments: Department[] = meta?.departments ?? [];
  const activeDepartment = departmentId || (departments[0] ? String(departments[0].id) : '');

  const refreshLineStock = useCallback(async (key: number, deptId: string, itemId: number, unitId: number | '') => {
    if (!deptId) return;
    try {
      const result = await api.get<{ items: Array<{ qty: number }> }>('/stocks', {
        departmentId: deptId,
        itemId,
        pageSize: 1,
      });
      setLines((current) =>
        current.map((line) =>
          line.key === key && line.item?.id === itemId
            ? { ...line, stock: result.items[0]?.qty ?? 0 }
            : line,
        ),
      );
    } catch {
      /* biarkan kosong */
    }
  }, []);

  const chooseItem = async (key: number, item: ItemSearchResult | null) => {
    if (!item) {
      setLines((current) => current.map((line) => (line.key === key ? { ...line, item: null, stock: null, conversions: [], unitId: '' } : line)));
      return;
    }
    setLines((current) =>
      current.map((line) =>
        line.key === key ? { ...line, item, loading: true, unitId: item.base_unit_id, stock: null, conversions: [] } : line,
      ),
    );
    try {
      const [stockResult, conversionResult] = await Promise.all([
        activeDepartment
          ? api.get<{ items: Array<{ qty: number }> }>('/stocks', { departmentId: activeDepartment, itemId: item.id, pageSize: 1 })
          : Promise.resolve({ items: [] }),
        api.get<{ items: Conversion[] }>(`/items/${item.id}/conversions`),
      ]);
      setLines((current) =>
        current.map((line) =>
          line.key === key && line.item?.id === item.id
            ? { ...line, stock: stockResult.items[0]?.qty ?? 0, conversions: conversionResult.items, loading: false }
            : line,
        ),
      );
    } catch {
      setLines((current) => current.map((line) => (line.key === key ? { ...line, loading: false } : line)));
    }
  };

  useEffect(() => {
    if (!activeDepartment) return;
    setLines((current) =>
      current.map((line) => {
        if (line.item) void refreshLineStock(line.key, activeDepartment, line.item.id, line.unitId);
        return line;
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDepartment]);

  useEffect(() => {
    if (presetApplied.current) return;
    const presetItem = params.get('itemId');
    if (!presetItem || !activeDepartment) return;
    presetApplied.current = true;
    api
      .get<{ items: Item[] }>('/items', { all: 1 })
      .then((result) => {
        const found = result.items.find((item) => item.id === Number(presetItem));
        if (found) {
          void chooseItem(lines[0].key, {
            id: found.id,
            code: found.code,
            name: found.name,
            base_unit_id: found.base_unit_id,
            unit_code: found.unit_code,
          });
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDepartment, params]);

  const updateLine = (key: number, patch: Partial<Line>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const lineAvailable = (line: Line): number | null => {
    if (line.stock === null) return null;
    const factor = line.unitId && line.unitId !== line.item?.base_unit_id
      ? line.conversions.find((conversion) => conversion.from_unit_id === line.unitId)?.factor ?? 1
      : 1;
    return line.stock / factor;
  };

  const lineUnitLabel = (line: Line): string => {
    if (!line.item) return '';
    if (!line.unitId || line.unitId === line.item.base_unit_id) return line.item.unit_code;
    return line.conversions.find((conversion) => conversion.from_unit_id === line.unitId)?.unit_code ?? line.item.unit_code;
  };

  const submit = async () => {
    setError('');
    if (!activeDepartment) {
      setError('Pilih bagian terlebih dahulu.');
      return;
    }
    const prepared = lines
      .filter((line) => line.item && Number(line.qty) > 0)
      .map((line) => ({
        itemId: line.item!.id,
        qty: Number(line.qty),
        unitId: line.unitId || line.item!.base_unit_id,
        notes: line.notes || null,
      }));
    if (!prepared.length) {
      setError('Tambahkan minimal satu barang dengan jumlah lebih dari 0.');
      return;
    }
    for (const line of lines.filter((row) => row.item && Number(row.qty) > 0)) {
      const available = lineAvailable(line);
      if (available !== null && Number(line.qty) > available + 1e-9) {
        setError(`Jumlah ${line.item!.name} melebihi stok tersedia (${formatNumber(available)} ${lineUnitLabel(line)}).`);
        return;
      }
    }
    setSaving(true);
    try {
      const result = await api.post<{ message: string }>('/consumptions', {
        departmentId: Number(activeDepartment),
        occurredAt,
        activityCategory: activityCategory || null,
        officerName: officerName || null,
        notes: notes || null,
        lines: prepared,
      });
      toast.success(result.message);
      setLines([newLine()]);
      setNotes('');
      await loadRecent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan pemakaian.');
    } finally {
      setSaving(false);
    }
  };

  const loadRecent = useCallback(async () => {
    setRecentLoading(true);
    try {
      const result = await api.get<{ items: RecentConsumption[] }>('/consumptions/recent', {
        departmentId: recentDept || undefined,
      });
      setRecent(result.items);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat riwayat pemakaian.');
    } finally {
      setRecentLoading(false);
    }
  }, [recentDept, toast]);

  useEffect(() => {
    if (tab === 'history') void loadRecent();
  }, [tab, loadRecent]);

  const openCorrection = (entry: RecentConsumption) => {
    setCorrection(entry);
    setNewQty(String(Math.abs(entry.qty_delta)));
    setCorrectionReason('');
    setCorrectionError('');
  };

  const submitCorrection = async () => {
    if (!correction) return;
    setCorrectionError('');
    if (correctionReason.trim().length < 10) {
      setCorrectionError('Alasan koreksi minimal 10 karakter.');
      return;
    }
    setCorrectionSaving(true);
    try {
      await api.post('/corrections', { entryId: correction.id, newQty: Number(newQty), reason: correctionReason });
      toast.success('Pengajuan koreksi dikirim dan menunggu persetujuan.');
      setCorrection(null);
      await loadRecent();
    } catch (err) {
      setCorrectionError(err instanceof Error ? err.message : 'Gagal mengajukan koreksi.');
    } finally {
      setCorrectionSaving(false);
    }
  };

  const openAction = (kind: ActionKind) => {
    setAction(kind);
    setActionItem(null);
    setActionStock(null);
    setActionQty('');
    setActionDate(today());
    setActionNotes('');
    setActionReason('');
    setActionDestination('');
    setActionError('');
  };

  const chooseActionItem = async (item: ItemSearchResult | null) => {
    setActionItem(item);
    setActionStock(null);
    if (!item) return;
    try {
      const result = await api.get<{ items: Array<{ qty: number }> }>('/stocks', {
        departmentId: activeDepartment,
        itemId: item.id,
        pageSize: 1,
      });
      setActionStock(result.items[0]?.qty ?? 0);
    } catch {
      setActionStock(0);
    }
  };

  const submitAction = async () => {
    if (!action || !actionItem) {
      setActionError('Pilih barang terlebih dahulu.');
      return;
    }
    setActionError('');
    const qty = Number(actionQty);
    if (!Number.isFinite(qty) || qty === 0 || (action !== 'ADJUSTMENT' && qty < 0)) {
      setActionError(action === 'ADJUSTMENT' ? 'Jumlah penyesuaian tidak boleh nol.' : 'Jumlah harus lebih dari 0.');
      return;
    }
    if (action !== 'ADJUSTMENT' && qty > (actionStock ?? 0) + 1e-9) {
      setActionError(`Jumlah melebihi stok tersedia (${formatNumber(actionStock ?? 0)} ${actionItem.unit_code}).`);
      return;
    }
    setActionSaving(true);
    try {
      if (action === 'RETURN') {
        await api.post('/returns', {
          departmentId: Number(activeDepartment),
          itemId: actionItem.id,
          qty,
          occurredAt: actionDate,
          destination: actionDestination || undefined,
          notes: actionNotes || undefined,
        });
        toast.success('Retur berhasil dicatat.');
      } else if (action === 'ADJUSTMENT') {
        await api.post('/adjustments', {
          departmentId: Number(activeDepartment),
          itemId: actionItem.id,
          qtyDelta: qty,
          occurredAt: actionDate,
          reason: actionReason,
          description: actionNotes || null,
        });
        toast.success('Pengajuan penyesuaian dikirim dan menunggu persetujuan.');
      } else {
        await api.post('/damages', {
          departmentId: Number(activeDepartment),
          itemId: actionItem.id,
          kind: action,
          qty,
          occurredAt: actionDate,
          notes: actionNotes,
          reason: actionReason,
        });
        toast.success('Pengajuan dikirim dan menunggu persetujuan.');
      }
      setAction(null);
      if (tab === 'history') await loadRecent();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Gagal memproses pengajuan.');
    } finally {
      setActionSaving(false);
    }
  };

  const totalLines = useMemo(() => lines.filter((line) => line.item && Number(line.qty) > 0).length, [lines]);
  const actionMeta = action ? ACTION_META[action] : null;

  return (
    <>
      <PageHeader
        title="Pemakaian Barang"
        subtitle="Catat pemakaian per bagian. Saldo langsung berkurang dan setiap baris tercatat pada kartu stok."
        actions={
          <div className="flex flex-wrap gap-2">
            {can('returns.create') ? (
              <Button variant="outline" size="sm" icon={<Undo2 className="h-4 w-4" />} onClick={() => openAction('RETURN')}>Retur</Button>
            ) : null}
            {can('damages.create') ? (
              <>
                <Button variant="outline" size="sm" icon={<Wrench className="h-4 w-4" />} onClick={() => openAction('DAMAGE')}>Rusak</Button>
                <Button variant="outline" size="sm" icon={<TriangleAlert className="h-4 w-4" />} onClick={() => openAction('LOSS')}>Hilang</Button>
              </>
            ) : null}
            {can('adjustments.request') ? (
              <Button variant="outline" size="sm" icon={<RotateCcw className="h-4 w-4" />} onClick={() => openAction('ADJUSTMENT')}>Penyesuaian</Button>
            ) : null}
          </div>
        }
      />

      <Card>
        <div className="border-b border-slate-100 px-3 pt-1">
          <Tabs
            tabs={[
              { key: 'entry', label: 'Catat Pemakaian' },
              { key: 'history', label: 'Riwayat Pemakaian' },
            ]}
            active={tab}
            onChange={setTab}
          />
        </div>

        {tab === 'entry' ? (
          <div className="p-4 sm:p-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Field label="Bagian" required>
                <Select value={activeDepartment} onChange={(event) => setDepartmentId(event.target.value)}>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>{department.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Tanggal pemakaian" required>
                <Input type="date" value={occurredAt} max={today()} onChange={(event) => setOccurredAt(event.target.value)} />
              </Field>
              <Field label="Kategori kegiatan" hint="Contoh: Pelayanan, Operasional, Rumah Tangga.">
                <Input value={activityCategory} onChange={(event) => setActivityCategory(event.target.value)} placeholder="Kategori kegiatan" />
              </Field>
              <Field label="Petugas / pemakai" hint="Kosongkan untuk memakai nama akun Anda.">
                <Input value={officerName} onChange={(event) => setOfficerName(event.target.value)} placeholder="Nama petugas" />
              </Field>
            </div>

            <div className="mt-5 overflow-hidden rounded-xl border border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2.5">
                <div>
                  <p className="text-xs font-semibold text-slate-700">Rincian Barang</p>
                  <p className="text-[11px] text-slate-500">Stok tersedia ditampilkan berdasarkan bagian terpilih.</p>
                </div>
                <Badge tone="teal">{totalLines} baris terisi</Badge>
              </div>

              <div className="scrollbar-thin overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="w-10 border-b border-slate-200 bg-white px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">#</th>
                      <th className="border-b border-slate-200 bg-white px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Barang</th>
                      <th className="w-40 border-b border-slate-200 bg-white px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Stok tersedia</th>
                      <th className="w-28 border-b border-slate-200 bg-white px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Satuan</th>
                      <th className="w-28 border-b border-slate-200 bg-white px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Jumlah</th>
                      <th className="border-b border-slate-200 bg-white px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Keterangan</th>
                      <th className="w-10 border-b border-slate-200 bg-white px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, index) => {
                      const available = lineAvailable(line);
                      const over = available !== null && Number(line.qty) > available + 1e-9;
                      return (
                        <tr key={line.key} className="align-top">
                          <td className="border-b border-slate-100 px-2 py-2 text-center text-xs text-slate-400">{index + 1}</td>
                          <td className="border-b border-slate-100 px-2 py-2">
                            <ItemSelect value={line.item} onChange={(item) => void chooseItem(line.key, item)} disabled={!activeDepartment} />
                          </td>
                          <td className="border-b border-slate-100 px-2 py-2 pt-4">
                            {line.loading ? (
                              <span className="text-[11px] text-slate-400">Memuat...</span>
                            ) : line.item ? (
                              <span className={over ? 'text-xs font-semibold text-rose-600' : 'text-xs font-medium text-slate-700'}>
                                {formatNumber(line.stock ?? 0)} {line.item.unit_code}
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-400">-</span>
                            )}
                          </td>
                          <td className="border-b border-slate-100 px-2 py-2 pt-3">
                            <select
                              value={line.unitId}
                              disabled={!line.item}
                              onChange={(event) => updateLine(line.key, { unitId: Number(event.target.value) })}
                              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs focus:border-brand-500 focus:outline-none"
                            >
                              {line.item ? <option value={line.item.base_unit_id}>{line.item.unit_code}</option> : <option>-</option>}
                              {line.conversions.map((conversion) => (
                                <option key={conversion.id} value={conversion.from_unit_id}>
                                  {conversion.unit_code} (×{formatNumber(conversion.factor)})
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="border-b border-slate-100 px-2 py-2 pt-3">
                            <Input
                              type="number"
                              min="0"
                              step="any"
                              value={line.qty}
                              disabled={!line.item}
                              onChange={(event) => updateLine(line.key, { qty: event.target.value })}
                              className={over ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-100' : ''}
                              placeholder="0"
                            />
                            {over ? <p className="mt-1 text-[10px] text-rose-600">Melebihi stok</p> : null}
                          </td>
                          <td className="border-b border-slate-100 px-2 py-2 pt-3">
                            <Input value={line.notes} onChange={(event) => updateLine(line.key, { notes: event.target.value })} placeholder="Opsional" />
                          </td>
                          <td className="border-b border-slate-100 px-2 py-2 pt-3 text-center">
                            <button
                              type="button"
                              onClick={() => setLines((current) => (current.length > 1 ? current.filter((row) => row.key !== line.key) : current))}
                              disabled={lines.length <= 1}
                              className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"
                              aria-label="Hapus baris"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-slate-200 bg-slate-50 px-3 py-2.5">
                <Button
                  variant="outline"
                  size="sm"
                  icon={<Plus className="h-4 w-4" />}
                  onClick={() => setLines((current) => [...current, newLine()])}
                  disabled={lines.length >= 50}
                >
                  Tambah Baris
                </Button>
              </div>
            </div>

            <div className="mt-4">
              <Field label="Catatan pemakaian">
                <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Catatan umum untuk transaksi ini (opsional)." />
              </Field>
            </div>

            {error ? (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <p className="text-xs text-slate-500">Saldo akan langsung berkurang setelah disimpan. Transaksi tidak dapat dihapus; gunakan koreksi bila perlu.</p>
              <Button loading={saving} onClick={() => void submit()} icon={<ShoppingCart className="h-4 w-4" />}>
                Simpan Pemakaian
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-3">
              <Select value={recentDept} onChange={(event) => setRecentDept(event.target.value)} className="max-w-xs">
                <option value="">Semua bagian saya</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>{department.name}</option>
                ))}
              </Select>
              <Button variant="outline" size="sm" onClick={() => void loadRecent()} icon={<History className="h-4 w-4" />}>Muat ulang</Button>
            </div>
            {recentLoading ? (
              <Spinner />
            ) : recent.length ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Transaksi</Th>
                    <Th>Barang</Th>
                    <Th>Bagian</Th>
                    <Th align="right">Qty</Th>
                    <Th align="right">Saldo</Th>
                    <Th>Kegiatan / Petugas</Th>
                    <Th align="right">Aksi</Th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50/60">
                      <Td>
                        <p className="font-mono text-[11px] text-slate-700">{entry.entry_no}</p>
                        <p className="text-[11px] text-slate-500">{formatDate(entry.occurred_at)}</p>
                      </Td>
                      <Td>
                        <p className="max-w-[220px] truncate text-sm font-medium text-slate-800">{entry.item_name}</p>
                        <p className="text-[11px] text-slate-500">oleh {entry.created_by_name}</p>
                      </Td>
                      <Td className="text-xs">{entry.department_name}</Td>
                      <Td align="right">
                        <span className="font-semibold text-rose-600">{formatNumber(Math.abs(entry.qty_delta))}</span>{' '}
                        <span className="text-[10px] text-slate-500">{entry.unit_code}</span>
                      </Td>
                      <Td align="right">{formatNumber(entry.balance_after)}</Td>
                      <Td className="text-xs">
                        {entry.activity_category ?? '-'}
                        <p className="text-[11px] text-slate-500">{entry.officer_name ?? '-'}</p>
                      </Td>
                      <Td align="right">
                        {can('consumptions.create') ? (
                          <Button size="sm" variant="outline" onClick={() => openCorrection(entry)}>Koreksi</Button>
                        ) : null}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState title="Belum ada pemakaian" description="Transaksi pemakaian yang dicatat akan tampil di sini." />
            )}
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(correction)}
        onClose={() => setCorrection(null)}
        title="Ajukan Koreksi Pemakaian"
        description={correction ? `${correction.item_name} · ${correction.entry_no}` : undefined}
        footer={
          <>
            <Button variant="outline" onClick={() => setCorrection(null)}>Batal</Button>
            <Button loading={correctionSaving} onClick={() => void submitCorrection()}>Kirim Pengajuan</Button>
          </>
        }
      >
        {correction ? (
          <div className="space-y-4">
            <InfoBanner tone="info" title="Perlu persetujuan">
              Koreksi tidak langsung mengubah saldo. Setelah disetujui, transaksi asli dibalik dan pemakaian baru dicatat
              pada ledger.
            </InfoBanner>
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <div>
                <p className="text-[11px] text-slate-500">Jumlah tercatat</p>
                <p className="font-semibold text-slate-800">{formatNumber(Math.abs(correction.qty_delta))} {correction.unit_code}</p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Tanggal</p>
                <p className="font-semibold text-slate-800">{formatDate(correction.occurred_at)}</p>
              </div>
            </div>
            <Field label="Jumlah seharusnya" required hint="Isi jumlah pemakaian yang benar. Boleh 0 bila transaksi seharusnya tidak ada.">
              <Input type="number" min="0" step="any" value={newQty} onChange={(event) => setNewQty(event.target.value)} />
            </Field>
            <Field label="Alasan koreksi" required error={correctionError}>
              <Textarea value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="Jelaskan kesalahan pencatatan dan dasar koreksi (minimal 10 karakter)." />
            </Field>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(action)}
        onClose={() => setAction(null)}
        title={actionMeta?.title ?? ''}
        description={actionMeta?.description}
        footer={
          <>
            <Button variant="outline" onClick={() => setAction(null)}>Batal</Button>
            <Button variant={actionMeta?.tone ?? 'primary'} loading={actionSaving} onClick={() => void submitAction()}>
              {actionMeta?.button ?? 'Simpan'}
            </Button>
          </>
        }
      >
        {action && actionMeta ? (
          <div className="space-y-4">
            <Field label="Bagian">
              <Input value={departments.find((department) => String(department.id) === activeDepartment)?.name ?? '-'} disabled />
            </Field>
            <Field label="Barang" required>
              <ItemSelect value={actionItem} onChange={(item) => void chooseActionItem(item)} />
            </Field>
            {actionItem ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Stok tersedia: <strong>{formatNumber(actionStock ?? 0)} {actionItem.unit_code}</strong>
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={action === 'ADJUSTMENT' ? 'Perubahan qty' : 'Jumlah'}
                required
                hint={action === 'ADJUSTMENT' ? 'Positif menambah, negatif mengurangi saldo.' : `Dalam satuan ${actionItem?.unit_code ?? 'dasar'}.`}
              >
                <Input
                  type="number"
                  step="any"
                  value={actionQty}
                  onChange={(event) => setActionQty(event.target.value)}
                  placeholder={action === 'ADJUSTMENT' ? 'contoh: -2 atau 3' : '0'}
                />
              </Field>
              <Field label="Tanggal" required>
                <Input type="date" value={actionDate} max={today()} onChange={(event) => setActionDate(event.target.value)} />
              </Field>
            </div>
            {action === 'RETURN' ? (
              <>
                <Field label="Tujuan retur">
                  <Input value={actionDestination} onChange={(event) => setActionDestination(event.target.value)} placeholder="Contoh: Gudang Logistik" />
                </Field>
                <Field label="Catatan">
                  <Textarea value={actionNotes} onChange={(event) => setActionNotes(event.target.value)} placeholder="Kondisi barang, nomor berita acara, dll." />
                </Field>
              </>
            ) : action === 'ADJUSTMENT' ? (
              <>
                <Field label="Alasan penyesuaian" required hint="Minimal 10 karakter.">
                  <Textarea value={actionReason} onChange={(event) => setActionReason(event.target.value)} placeholder="Contoh: koreksi saldo awal hasil verifikasi fisik." />
                </Field>
                <Field label="Keterangan tambahan">
                  <Input value={actionNotes} onChange={(event) => setActionNotes(event.target.value)} placeholder="Opsional" />
                </Field>
              </>
            ) : (
              <>
                <Field label="Alasan" required hint="Minimal 5 karakter.">
                  <Textarea value={actionReason} onChange={(event) => setActionReason(event.target.value)} placeholder="Jelaskan penyebab barang rusak/hilang/kedaluwarsa." />
                </Field>
                <Field label="Keterangan" required hint="Minimal 5 karakter.">
                  <Textarea value={actionNotes} onChange={(event) => setActionNotes(event.target.value)} placeholder="Kondisi dan detail temuan." />
                </Field>
              </>
            )}
            {actionError ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{actionError}</div> : null}
            {['DAMAGE', 'LOSS', 'EXPIRED', 'ADJUSTMENT'].includes(action) ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <ArrowDownToLine className="mt-0.5 h-4 w-4 shrink-0" />
                Pengajuan akan masuk ke antrean persetujuan. Saldo belum berubah sampai disetujui.
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
