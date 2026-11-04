import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight, Boxes, Pencil, Plus, Ruler, Tags, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { Category, Item, Meta, Paginated, Unit } from '../types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Spinner,
  Table,
  Tabs,
  Td,
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

const emptyItem = {
  code: '',
  simdondarCode: '',
  name: '',
  categoryId: '',
  baseUnitId: '',
  minStock: '0',
  trackBatch: false,
  isActive: true,
};

export function ItemsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('items');
  const [meta, setMeta] = useState<Meta | null>(null);
  const [items, setItems] = useState<Paginated<Item> | null>(null);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [itemModal, setItemModal] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [form, setForm] = useState({ ...emptyItem });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [conversionItem, setConversionItem] = useState<Item | null>(null);
  const [conversions, setConversions] = useState<Conversion[]>([]);
  const [conversionUnit, setConversionUnit] = useState('');
  const [conversionFactor, setConversionFactor] = useState('');
  const [conversionSaving, setConversionSaving] = useState(false);

  const [categoryModal, setCategoryModal] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [unitModal, setUnitModal] = useState(false);
  const [unitCode, setUnitCode] = useState('');
  const [unitName, setUnitName] = useState('');
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [masterSaving, setMasterSaving] = useState(false);

  const canManage = can('items.manage');

  const loadMeta = useCallback(async () => {
    try {
      setMeta(await api.get<Meta>('/meta'));
    } catch {
      /* abaikan */
    }
  }, []);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.get<Paginated<Item>>('/items', {
        page,
        pageSize: 25,
        search,
        categoryId: categoryId || undefined,
      });
      setItems(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat barang.');
    } finally {
      setLoading(false);
    }
  }, [page, search, categoryId]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadItems(), 250);
    return () => window.clearTimeout(timer);
  }, [loadItems]);

  const categories: Category[] = meta?.categories ?? [];
  const units: Unit[] = meta?.units ?? [];

  const openCreate = () => {
    setEditing(null);
    setForm({
      ...emptyItem,
      categoryId: categories.length ? String(categories[0].id) : '',
      baseUnitId: units.length ? String(units[0].id) : '',
    });
    setFormError('');
    setItemModal(true);
  };

  const openEdit = (item: Item) => {
    setEditing(item);
    setForm({
      code: item.code,
      simdondarCode: item.simdondar_code ?? '',
      name: item.name,
      categoryId: item.category_id ? String(item.category_id) : '',
      baseUnitId: String(item.base_unit_id),
      minStock: String(item.min_stock),
      trackBatch: Boolean(item.track_batch),
      isActive: Boolean(item.is_active),
    });
    setFormError('');
    setItemModal(true);
  };

  const saveItem = async () => {
    setFormError('');
    if (!form.code.trim() || !form.name.trim() || !form.baseUnitId) {
      setFormError('Kode, nama, dan satuan dasar wajib diisi.');
      return;
    }
    setSaving(true);
    try {
      const body = {
        code: form.code,
        simdondarCode: form.simdondarCode || null,
        name: form.name,
        categoryId: form.categoryId ? Number(form.categoryId) : null,
        baseUnitId: Number(form.baseUnitId),
        minStock: Number(form.minStock || 0),
        trackBatch: form.trackBatch,
        isActive: form.isActive,
      };
      if (editing) {
        await api.patch(`/items/${editing.id}`, body);
        toast.success('Master barang diperbarui.');
      } else {
        await api.post('/items', body);
        toast.success('Barang baru ditambahkan.');
      }
      setItemModal(false);
      await loadItems();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal menyimpan barang.');
    } finally {
      setSaving(false);
    }
  };

  const openConversions = async (item: Item) => {
    setConversionItem(item);
    setConversionUnit('');
    setConversionFactor('');
    try {
      const result = await api.get<{ items: Conversion[] }>(`/items/${item.id}/conversions`);
      setConversions(result.items);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat konversi.');
    }
  };

  const addConversion = async () => {
    if (!conversionItem || !conversionUnit || !conversionFactor) return;
    setConversionSaving(true);
    try {
      await api.post(`/items/${conversionItem.id}/conversions`, {
        fromUnitId: Number(conversionUnit),
        factor: Number(conversionFactor),
      });
      const result = await api.get<{ items: Conversion[] }>(`/items/${conversionItem.id}/conversions`);
      setConversions(result.items);
      setConversionUnit('');
      setConversionFactor('');
      toast.success('Konversi satuan ditambahkan.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menambah konversi.');
    } finally {
      setConversionSaving(false);
    }
  };

  const removeConversion = async (conversion: Conversion) => {
    if (!conversionItem) return;
    try {
      await api.delete(`/items/${conversionItem.id}/conversions/${conversion.id}`);
      setConversions((current) => current.filter((row) => row.id !== conversion.id));
      toast.success('Konversi dihapus.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus konversi.');
    }
  };

  const saveCategory = async () => {
    if (!categoryName.trim()) return;
    setMasterSaving(true);
    try {
      if (editingCategory) {
        await api.patch(`/categories/${editingCategory.id}`, { name: categoryName });
        toast.success('Kategori diperbarui.');
      } else {
        await api.post('/categories', { name: categoryName });
        toast.success('Kategori ditambahkan.');
      }
      setCategoryModal(false);
      setCategoryName('');
      setEditingCategory(null);
      await loadMeta();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan kategori.');
    } finally {
      setMasterSaving(false);
    }
  };

  const saveUnit = async () => {
    if (!unitCode.trim() || !unitName.trim()) return;
    setMasterSaving(true);
    try {
      if (editingUnit) {
        await api.patch(`/units/${editingUnit.id}`, { name: unitName });
        toast.success('Satuan diperbarui.');
      } else {
        await api.post('/units', { code: unitCode, name: unitName });
        toast.success('Satuan ditambahkan.');
      }
      setUnitModal(false);
      setUnitCode('');
      setUnitName('');
      setEditingUnit(null);
      await loadMeta();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan satuan.');
    } finally {
      setMasterSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Master Barang & Satuan"
        subtitle="Kelola barang, kategori, satuan, dan konversi. Kode SIMDONDAR dipakai untuk mencocokkan hasil impor."
        actions={canManage && tab === 'items' ? <Button onClick={openCreate} icon={<Plus className="h-4 w-4" />}>Tambah Barang</Button> : null}
      />

      <Card>
        <div className="border-b border-slate-100 px-3 pt-1">
          <Tabs
            tabs={[
              { key: 'items', label: 'Barang', count: items?.pagination.total },
              { key: 'categories', label: 'Kategori', count: categories.length },
              { key: 'units', label: 'Satuan', count: units.length },
            ]}
            active={tab}
            onChange={setTab}
          />
        </div>

        {tab === 'items' ? (
          <>
            <div className="grid gap-2.5 border-b border-slate-100 p-3 sm:grid-cols-3">
              <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Cari kode atau nama barang..." className="sm:col-span-2" />
              <Select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(1); }}>
                <option value="">Semua kategori</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </Select>
            </div>
            {error ? <div className="m-4 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{error}</div> : null}
            {loading && !items ? (
              <Spinner />
            ) : items && items.items.length ? (
              <>
                <Table>
                  <thead>
                    <tr>
                      <Th>Barang</Th>
                      <Th>Kode SIMDONDAR</Th>
                      <Th>Kategori</Th>
                      <Th>Satuan</Th>
                      <Th align="right">Minimum</Th>
                      <Th>Status</Th>
                      <Th align="right">Aksi</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.items.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/60">
                        <Td>
                          <p className="font-medium text-slate-800">{item.name}</p>
                          <p className="text-[11px] text-slate-500">{item.code}</p>
                        </Td>
                        <Td className="text-xs text-slate-600">{item.simdondar_code ?? '-'}</Td>
                        <Td className="text-xs">{item.category_name ?? '-'}</Td>
                        <Td className="text-xs">{item.unit_code} <span className="text-slate-400">· {item.unit_name}</span></Td>
                        <Td align="right" className="text-xs">{formatNumber(item.min_stock)}</Td>
                        <Td>{item.is_active ? <Badge tone="green">Aktif</Badge> : <Badge tone="gray">Nonaktif</Badge>}</Td>
                        <Td align="right">
                          {canManage ? (
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="outline" onClick={() => openEdit(item)} icon={<Pencil className="h-3.5 w-3.5" />}>Ubah</Button>
                              <Button size="sm" variant="outline" onClick={() => void openConversions(item)} icon={<ArrowLeftRight className="h-3.5 w-3.5" />}>Konversi</Button>
                            </div>
                          ) : null}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <Pagination page={items.pagination.page} totalPages={items.pagination.totalPages} total={items.pagination.total} onChange={setPage} />
              </>
            ) : (
              <EmptyState title="Belum ada barang" description="Tambahkan barang terlebih dahulu atau impor master barang dari SIMDONDAR." />
            )}
          </>
        ) : tab === 'categories' ? (
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <p className="text-xs text-slate-500">Kategori membantu pengelompokan barang pada laporan dan filter.</p>
              {canManage ? <Button size="sm" onClick={() => { setEditingCategory(null); setCategoryName(''); setCategoryModal(true); }} icon={<Plus className="h-4 w-4" />}>Tambah Kategori</Button> : null}
            </div>
            {categories.length ? (
              <Table>
                <thead><tr><Th>Nama kategori</Th><Th>Status</Th><Th align="right">Aksi</Th></tr></thead>
                <tbody>
                  {categories.map((category) => (
                    <tr key={category.id}>
                      <Td className="font-medium text-slate-800">{category.name}</Td>
                      <Td>{category.is_active ? <Badge tone="green">Aktif</Badge> : <Badge tone="gray">Nonaktif</Badge>}</Td>
                      <Td align="right">
                        {canManage ? <Button size="sm" variant="outline" onClick={() => { setEditingCategory(category); setCategoryName(category.name); setCategoryModal(true); }}>Ubah</Button> : null}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState title="Belum ada kategori" description="Tambahkan kategori untuk mengelompokkan barang." />
            )}
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <p className="text-xs text-slate-500">Satuan dasar dipakai untuk saldo. Satuan lain dihubungkan melalui konversi per barang.</p>
              {canManage ? <Button size="sm" onClick={() => { setEditingUnit(null); setUnitCode(''); setUnitName(''); setUnitModal(true); }} icon={<Plus className="h-4 w-4" />}>Tambah Satuan</Button> : null}
            </div>
            {units.length ? (
              <Table>
                <thead><tr><Th>Kode</Th><Th>Nama</Th><Th>Status</Th><Th align="right">Aksi</Th></tr></thead>
                <tbody>
                  {units.map((unit) => (
                    <tr key={unit.id}>
                      <Td><Badge tone="blue">{unit.code}</Badge></Td>
                      <Td className="text-slate-800">{unit.name}</Td>
                      <Td>{unit.is_active ? <Badge tone="green">Aktif</Badge> : <Badge tone="gray">Nonaktif</Badge>}</Td>
                      <Td align="right">
                        {canManage ? <Button size="sm" variant="outline" onClick={() => { setEditingUnit(unit); setUnitCode(unit.code); setUnitName(unit.name); setUnitModal(true); }}>Ubah</Button> : null}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState title="Belum ada satuan" description="Tambahkan satuan seperti pcs, box, pack, atau liter." />
            )}
          </div>
        )}
      </Card>

      <Modal
        open={itemModal}
        onClose={() => setItemModal(false)}
        title={editing ? 'Ubah Barang' : 'Tambah Barang'}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setItemModal(false)}>Batal</Button>
            <Button loading={saving} onClick={() => void saveItem()}>Simpan</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kode barang" required>
            <Input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="Contoh: BRG-001" />
          </Field>
          <Field label="Kode SIMDONDAR" hint="Dipakai untuk mencocokkan impor.">
            <Input value={form.simdondarCode} onChange={(event) => setForm({ ...form, simdondarCode: event.target.value })} placeholder="Kode pada SIMDONDAR" />
          </Field>
          <Field label="Nama barang" required className="sm:col-span-2">
            <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Nama lengkap barang" />
          </Field>
          <Field label="Kategori">
            <Select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>
              <option value="">Tanpa kategori</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </Select>
          </Field>
          <Field label="Satuan dasar" required>
            <Select value={form.baseUnitId} onChange={(event) => setForm({ ...form, baseUnitId: event.target.value })}>
              <option value="">Pilih satuan</option>
              {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} — {unit.name}</option>)}
            </Select>
          </Field>
          <Field label="Stok minimum" hint="Ambang peringatan stok menipis.">
            <Input type="number" min="0" step="any" value={form.minStock} onChange={(event) => setForm({ ...form, minStock: event.target.value })} />
          </Field>
          <div className="flex flex-col justify-center gap-2 pt-4">
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={form.trackBatch} onChange={(event) => setForm({ ...form, trackBatch: event.target.checked })} />
              Lacak batch / nomor lot
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
              Barang aktif
            </label>
          </div>
          {formError ? <div className="sm:col-span-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{formError}</div> : null}
        </div>
      </Modal>

      <Modal
        open={Boolean(conversionItem)}
        onClose={() => setConversionItem(null)}
        title="Konversi Satuan"
        description={conversionItem ? `${conversionItem.name} · satuan dasar ${conversionItem.unit_code}` : undefined}
        footer={<Button variant="outline" onClick={() => setConversionItem(null)}>Tutup</Button>}
      >
        {conversionItem ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-800">
              Satu satuan konversi = faktor × satuan dasar {conversionItem.unit_code}. Contoh: 1 box = 10 pack berarti faktor 10.
            </div>
            {conversions.length ? (
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead><tr><Th>Satuan</Th><Th align="right">Faktor</Th><Th align="right">Aksi</Th></tr></thead>
                  <tbody>
                    {conversions.map((conversion) => (
                      <tr key={conversion.id}>
                        <Td>{conversion.unit_code} <span className="text-xs text-slate-500">({conversion.unit_name})</span></Td>
                        <Td align="right">×{formatNumber(conversion.factor)}</Td>
                        <Td align="right">
                          <button onClick={() => void removeConversion(conversion)} className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Hapus">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-slate-500">Belum ada konversi untuk barang ini.</p>
            )}
            {canManage ? (
              <div className="grid items-end gap-2 sm:grid-cols-[1fr_120px_auto]">
                <Field label="Satuan">
                  <Select value={conversionUnit} onChange={(event) => setConversionUnit(event.target.value)}>
                    <option value="">Pilih satuan</option>
                    {units.filter((unit) => unit.id !== conversionItem.base_unit_id).map((unit) => (
                      <option key={unit.id} value={unit.id}>{unit.code} — {unit.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Faktor">
                  <Input type="number" min="0" step="any" value={conversionFactor} onChange={(event) => setConversionFactor(event.target.value)} placeholder="10" />
                </Field>
                <Button loading={conversionSaving} onClick={() => void addConversion()} disabled={!conversionUnit || !conversionFactor}>Tambah</Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={categoryModal}
        onClose={() => setCategoryModal(false)}
        title={editingCategory ? 'Ubah Kategori' : 'Tambah Kategori'}
        footer={<><Button variant="outline" onClick={() => setCategoryModal(false)}>Batal</Button><Button loading={masterSaving} onClick={() => void saveCategory()}>Simpan</Button></>}
      >
        <Field label="Nama kategori" required>
          <Input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="Contoh: Bahan Habis Pakai" />
        </Field>
      </Modal>

      <Modal
        open={unitModal}
        onClose={() => setUnitModal(false)}
        title={editingUnit ? 'Ubah Satuan' : 'Tambah Satuan'}
        footer={<><Button variant="outline" onClick={() => setUnitModal(false)}>Batal</Button><Button loading={masterSaving} onClick={() => void saveUnit()}>Simpan</Button></>}
      >
        <div className="space-y-3">
          <Field label="Kode satuan" required>
            <Input value={unitCode} disabled={Boolean(editingUnit)} onChange={(event) => setUnitCode(event.target.value.toUpperCase())} placeholder="Contoh: PCS" />
          </Field>
          <Field label="Nama satuan" required>
            <Input value={unitName} onChange={(event) => setUnitName(event.target.value)} placeholder="Contoh: Pieces" />
          </Field>
        </div>
      </Modal>
    </>
  );
}
