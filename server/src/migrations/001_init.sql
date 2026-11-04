-- =====================================================================
-- 001_init.sql — Skema inti Sistem Monitoring Stok dan Pemakaian
-- Semua timestamp disimpan ISO-8601 UTC (TEXT). Tanggal transaksi YYYY-MM-DD.
-- =====================================================================

CREATE TABLE roles (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE permissions (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  email TEXT,
  password_hash TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  last_login_at TEXT,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE departments (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  simdondar_code TEXT UNIQUE,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  head_name TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE user_departments (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, department_id)
);

CREATE TABLE item_categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE units (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  simdondar_code TEXT UNIQUE,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES item_categories(id),
  base_unit_id INTEGER NOT NULL REFERENCES units(id),
  min_stock REAL NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  track_batch INTEGER NOT NULL DEFAULT 0 CHECK (track_batch IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_items_name ON items(name);
CREATE INDEX idx_items_category ON items(category_id);

CREATE TABLE item_unit_conversions (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  from_unit_id INTEGER NOT NULL REFERENCES units(id),
  factor REAL NOT NULL CHECK (factor > 0),
  created_at TEXT NOT NULL,
  UNIQUE (item_id, from_unit_id)
);

CREATE TABLE simdondar_import_batches (
  id INTEGER PRIMARY KEY,
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  original_headers_json TEXT NOT NULL DEFAULT '[]',
  mapping_json TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'VALIDATED', 'COMMITTED', 'CANCELLED')),
  total_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  warning_rows INTEGER NOT NULL DEFAULT 0,
  error_rows INTEGER NOT NULL DEFAULT 0,
  duplicate_rows INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  receipt_mode TEXT NOT NULL DEFAULT 'confirm',
  notes TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  validated_at TEXT,
  completed_at TEXT
);

CREATE TABLE simdondar_import_rows (
  id INTEGER PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES simdondar_import_batches(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  raw_json TEXT NOT NULL,
  parsed_json TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'VALID', 'WARNING', 'ERROR', 'DUPLICATE', 'IMPORTED', 'SKIPPED')),
  errors_json TEXT NOT NULL DEFAULT '[]',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  fingerprint TEXT,
  identity TEXT,
  simdondar_transaction_id INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (batch_id, row_number)
);
CREATE INDEX idx_import_rows_batch ON simdondar_import_rows(batch_id);

CREATE TABLE simdondar_transactions (
  id INTEGER PRIMARY KEY,
  import_batch_id INTEGER REFERENCES simdondar_import_batches(id),
  import_row_id INTEGER REFERENCES simdondar_import_rows(id),
  source_doc_number TEXT,
  source_line_number TEXT,
  source_identity TEXT NOT NULL UNIQUE,
  source_date TEXT NOT NULL,
  department_id INTEGER NOT NULL REFERENCES departments(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  unit_id INTEGER NOT NULL REFERENCES units(id),
  qty_requested REAL,
  qty_approved REAL,
  qty_issued REAL NOT NULL CHECK (qty_issued > 0),
  qty_received REAL,
  status TEXT NOT NULL DEFAULT 'AWAITING_RECEIPT'
    CHECK (status IN ('AWAITING_RECEIPT', 'RECEIVED', 'RECEIVED_WITH_DISCREPANCY', 'DISPUTED', 'CANCELLED')),
  notes TEXT,
  raw_json TEXT,
  receipt_entry_id INTEGER REFERENCES stock_entries(id),
  received_by INTEGER REFERENCES users(id),
  received_at TEXT,
  received_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_simdondar_tx_dept ON simdondar_transactions(department_id, source_date);
CREATE INDEX idx_simdondar_tx_status ON simdondar_transactions(status);
CREATE INDEX idx_simdondar_tx_doc ON simdondar_transactions(source_doc_number);

CREATE TABLE department_stock_balances (
  department_id INTEGER NOT NULL REFERENCES departments(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  qty REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (department_id, item_id)
);
CREATE INDEX idx_balances_item ON department_stock_balances(item_id);

CREATE TABLE stock_entries (
  id INTEGER PRIMARY KEY,
  entry_no TEXT NOT NULL UNIQUE,
  department_id INTEGER NOT NULL REFERENCES departments(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  entry_type TEXT NOT NULL CHECK (entry_type IN
    ('RECEIPT', 'CONSUMPTION', 'RETURN', 'DAMAGE', 'LOSS', 'EXPIRED', 'ADJUSTMENT', 'REVERSAL', 'OPENING')),
  qty_delta REAL NOT NULL CHECK (qty_delta <> 0),
  unit_id INTEGER NOT NULL REFERENCES units(id),
  balance_after REAL NOT NULL CHECK (balance_after >= -0.000001),
  occurred_at TEXT NOT NULL,
  posted_at TEXT NOT NULL,
  source_type TEXT,
  source_id TEXT,
  source_ref TEXT,
  description TEXT,
  reason TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  reversed_entry_id INTEGER REFERENCES stock_entries(id),
  is_reversal INTEGER NOT NULL DEFAULT 0 CHECK (is_reversal IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_stock_entries_reversal ON stock_entries(reversed_entry_id)
  WHERE reversed_entry_id IS NOT NULL;
CREATE INDEX idx_stock_entries_card ON stock_entries(department_id, item_id, occurred_at, id);
CREATE INDEX idx_stock_entries_type ON stock_entries(entry_type, occurred_at);
CREATE INDEX idx_stock_entries_source ON stock_entries(source_type, source_id);

CREATE TABLE stock_consumptions (
  id INTEGER PRIMARY KEY,
  entry_id INTEGER NOT NULL UNIQUE REFERENCES stock_entries(id),
  activity_category TEXT,
  officer_name TEXT,
  notes TEXT,
  is_correction INTEGER NOT NULL DEFAULT 0 CHECK (is_correction IN (0, 1)),
  correction_of_entry_id INTEGER REFERENCES stock_entries(id),
  created_at TEXT NOT NULL
);

CREATE TABLE stock_returns (
  id INTEGER PRIMARY KEY,
  entry_id INTEGER NOT NULL UNIQUE REFERENCES stock_entries(id),
  destination TEXT NOT NULL DEFAULT 'LOGISTIK',
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE stock_damages (
  id INTEGER PRIMARY KEY,
  entry_id INTEGER NOT NULL UNIQUE REFERENCES stock_entries(id),
  kind TEXT NOT NULL CHECK (kind IN ('DAMAGE', 'LOSS', 'EXPIRED')),
  notes TEXT,
  attachment_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE stock_adjustments (
  id INTEGER PRIMARY KEY,
  entry_id INTEGER NOT NULL UNIQUE REFERENCES stock_entries(id),
  reason TEXT NOT NULL,
  approval_id INTEGER,
  opname_detail_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE stock_opname_sessions (
  id INTEGER PRIMARY KEY,
  department_id INTEGER NOT NULL REFERENCES departments(id),
  period TEXT NOT NULL,
  opname_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  notes TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  submitted_at TEXT,
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT,
  approval_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_opname_dept ON stock_opname_sessions(department_id, opname_date);

CREATE TABLE stock_opname_details (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES stock_opname_sessions(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  system_qty REAL NOT NULL,
  physical_qty REAL,
  difference REAL,
  reason TEXT,
  adjustment_entry_id INTEGER REFERENCES stock_entries(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (session_id, item_id)
);

CREATE TABLE approval_requests (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('ADJUSTMENT', 'OPNAME', 'DAMAGE', 'LOSS', 'EXPIRED', 'CORRECTION')),
  department_id INTEGER NOT NULL REFERENCES departments(id),
  item_id INTEGER REFERENCES items(id),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  reason TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  summary TEXT,
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT,
  resulting_entry_id INTEGER REFERENCES stock_entries(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_approvals_status ON approval_requests(status, created_at);
CREATE INDEX idx_approvals_dept ON approval_requests(department_id);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id),
  actor_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read, created_at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id)
);

CREATE TABLE document_sequences (
  prefix TEXT NOT NULL,
  period TEXT NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (prefix, period)
);

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  path TEXT NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE import_mapping_profiles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  mapping_json TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
