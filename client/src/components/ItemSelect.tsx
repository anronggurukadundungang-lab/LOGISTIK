import { useEffect, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from './ui';

export interface ItemSearchResult {
  id: number;
  code: string;
  name: string;
  base_unit_id: number;
  unit_code: string;
}

export function ItemSelect({
  value,
  onChange,
  placeholder = 'Cari nama atau kode barang...',
  disabled,
  className,
}: {
  value: ItemSearchResult | null;
  onChange: (item: ItemSearchResult | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ItemSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const result = await api.get<{ items: ItemSearchResult[] }>('/search/items', { q: query });
        setResults(result.items);
        setHighlight(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query, open]);

  const select = (item: ItemSearchResult) => {
    onChange(item);
    setQuery('');
    setOpen(false);
  };

  return (
    <div className={cn('relative', className)} ref={ref}>
      {value ? (
        <div className="flex h-10 items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm">
          <span className="min-w-0 truncate">
            <span className="font-medium text-slate-800">{value.name}</span>
            <span className="ml-1.5 text-[11px] text-slate-500">{value.code}</span>
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(null)}
            className="shrink-0 text-[11px] font-medium text-brand-700 hover:underline"
          >
            Ganti
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            disabled={disabled}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setHighlight((value) => Math.min(value + 1, results.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setHighlight((value) => Math.max(value - 1, 0));
              } else if (event.key === 'Enter' && results[highlight]) {
                event.preventDefault();
                select(results[highlight]);
              }
            }}
            placeholder={placeholder}
            className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm placeholder:text-slate-400 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
          />
        </div>
      )}
      {open && !value ? (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-3 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Mencari...
            </div>
          ) : results.length ? (
            results.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onMouseEnter={() => setHighlight(index)}
                onClick={() => select(item)}
                className={cn(
                  'block w-full px-3 py-2 text-left text-sm',
                  index === highlight ? 'bg-brand-50 text-brand-900' : 'text-slate-700 hover:bg-slate-50',
                )}
              >
                <span className="block truncate font-medium">{item.name}</span>
                <span className="block text-[11px] text-slate-500">{item.code} · {item.unit_code}</span>
              </button>
            ))
          ) : (
            <p className="px-3 py-3 text-xs text-slate-500">
              {query ? 'Barang tidak ditemukan. Tambahkan melalui master barang.' : 'Ketik untuk mencari barang.'}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
