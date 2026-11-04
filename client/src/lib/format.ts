export function formatNumber(value: unknown, maxFraction = 2): string {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return '-';
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: maxFraction }).format(number);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value.length <= 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  }).format(date);
}

export function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function monthStart(): string {
  return `${today().slice(0, 7)}-01`;
}

export function monthLabel(value: string): string {
  if (!value) return '-';
  const date = new Date(value.length === 7 ? `${value}-01T00:00:00Z` : `${value}T00:00:00Z`);
  return new Intl.DateTimeFormat('id-ID', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

export const ENTRY_LABELS: Record<string, string> = {
  RECEIPT: 'Penerimaan',
  OPENING: 'Saldo Awal',
  CONSUMPTION: 'Pemakaian',
  RETURN: 'Retur',
  DAMAGE: 'Rusak',
  LOSS: 'Hilang',
  EXPIRED: 'Kedaluwarsa',
  ADJUSTMENT: 'Penyesuaian',
  REVERSAL: 'Pembalik',
};

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draf',
  VALIDATED: 'Tervalidasi',
  COMMITTED: 'Selesai',
  CANCELLED: 'Dibatalkan',
  PENDING: 'Menunggu',
  SUBMITTED: 'Diajukan',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
  AWAITING_RECEIPT: 'Menunggu diterima',
  RECEIVED: 'Diterima',
  RECEIVED_WITH_DISCREPANCY: 'Diterima (selisih)',
  DISPUTED: 'Disengketakan',
  VALID: 'Valid',
  WARNING: 'Peringatan',
  ERROR: 'Gagal',
  DUPLICATE: 'Duplikat',
  IMPORTED: 'Terimpor',
  SKIPPED: 'Dilewati',
  DAMAGE: 'Rusak',
  LOSS: 'Hilang',
  EXPIRED: 'Kedaluwarsa',
  CORRECTION: 'Koreksi',
  OPNAME: 'Stok Opname',
  ADJUSTMENT: 'Penyesuaian',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function entryLabel(type: string): string {
  return ENTRY_LABELS[type] ?? type;
}
