export interface User {
  id: number;
  username: string;
  name: string;
  role: { code: string; name: string };
  permissions: string[];
  departmentIds: number[];
  allDepartments: boolean;
  mustChangePassword: boolean;
  csrfToken: string;
}

export interface Department {
  id: number;
  code: string;
  simdondar_code: string | null;
  name: string;
  head_name: string | null;
  is_active: number;
  item_count?: number;
}

export interface Unit {
  id: number;
  code: string;
  name: string;
  is_active: number;
}

export interface Category {
  id: number;
  name: string;
  is_active: number;
}

export interface Item {
  id: number;
  code: string;
  simdondar_code: string | null;
  name: string;
  category_id: number | null;
  category_name: string | null;
  base_unit_id: number;
  unit_code: string;
  unit_name: string;
  min_stock: number;
  track_batch: number;
  is_active: number;
}

export interface Meta {
  departments: Department[];
  units: Unit[];
  categories: Category[];
  settings: Record<string, string>;
  today: string;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  items: T[];
  pagination: Pagination;
}

export interface StockRow {
  department_id: number;
  department_name: string;
  item_id: number;
  item_code: string;
  item_name: string;
  unit_code: string;
  qty: number;
  min_stock: number;
  received_total: number;
  consumption_total: number;
  return_total: number;
  damage_total: number;
  physical_qty: number | null;
  opname_difference: number | null;
  last_opname_date: string | null;
  stock_status: 'safe' | 'low' | 'critical';
  category_name: string | null;
  category_id: number | null;
}

export interface StockEntry {
  id: number;
  entry_no: string;
  department_id: number;
  department_name: string;
  item_id: number;
  item_code: string;
  item_name: string;
  entry_type: string;
  qty_delta: number;
  balance_after: number;
  unit_code: string;
  occurred_at: string;
  description: string | null;
  source_ref: string | null;
  source_doc_number?: string | null;
  reason: string | null;
  created_by_name: string;
  created_at: string;
  activity_category?: string | null;
  officer_name?: string | null;
  damage_kind?: string | null;
  damage_notes?: string | null;
  adjustment_reason?: string | null;
  reversed_entry_no?: string | null;
}

export interface SimdondarReceipt {
  id: number;
  source_doc_number: string | null;
  source_date: string;
  department_id: number;
  department_name: string;
  item_code: string;
  item_name: string;
  unit_code: string;
  qty_issued: number;
  qty_received: number | null;
  status: string;
  import_filename: string | null;
  received_by_name: string | null;
  received_note: string | null;
}

export interface ImportBatch {
  id: number;
  filename: string;
  file_type: string;
  status: string;
  total_rows: number;
  valid_rows: number;
  warning_rows: number;
  error_rows: number;
  duplicate_rows: number;
  imported_rows: number;
  receipt_mode: string;
  created_at: string;
  completed_at: string | null;
  created_by_name: string;
  transaction_count: number;
}

export interface ImportRow {
  rowNumber: number;
  status: string;
  raw: Record<string, string | number | null>;
  parsed: {
    date?: string;
    itemName?: string;
    departmentName?: string;
    unitLabel?: string;
    qtyIssued?: number;
    qtyIssuedSource?: number;
    docNumber?: string | null;
    lineNumber?: string | null;
  } | null;
  errors: string[];
  warnings: string[];
  identity?: string;
  transactionId?: number | null;
}

export interface Approval {
  id: number;
  type: string;
  department_id: number;
  department_name: string;
  item_id: number | null;
  item_name: string | null;
  requested_by: number;
  requester_name: string;
  status: string;
  reason: string;
  summary: string;
  payload: Record<string, unknown>;
  created_at: string;
  decided_at: string | null;
  decided_by_name: string | null;
  decision_note: string | null;
  is_own_request: boolean;
}

export interface OpnameSession {
  id: number;
  department_id: number;
  department_name: string;
  period: string;
  opname_date: string;
  status: string;
  notes: string | null;
  item_count: number;
  diff_count: number;
  unfilled_count: number;
  created_by_name: string;
  created_at: string;
  approval_id: number | null;
  decision_note: string | null;
}

export interface ReportData {
  type: string;
  title: string;
  subtitle: string;
  columns: Array<{ key: string; header: string; width?: number; type?: string }>;
  rows: Array<Record<string, unknown>>;
  summary: Array<{ label: string; value: string | number }>;
  filterLabels: Array<{ label: string; value: string }>;
  generatedAt: string;
  generatedBy: string;
  truncated: boolean;
}
