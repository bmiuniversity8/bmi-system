-- Migration: 0050_centralized_finance_fx_billing
-- Centralized Fees, Billing, FX, Invoicing, Payments & Student Account Engine

-- 1. CURRENCIES
CREATE TABLE IF NOT EXISTS currencies (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  minor_unit  INTEGER NOT NULL DEFAULT 2,
  is_base     INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO currencies (code, name, symbol, minor_unit, is_base, is_active)
VALUES 
  ('USD', 'US Dollar', '$', 2, 1, 1),
  ('KES', 'Kenyan Shilling', 'KSh', 2, 0, 1);

-- 2. EXCHANGE RATES
CREATE TABLE IF NOT EXISTS exchange_rates (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  base_currency     TEXT NOT NULL REFERENCES currencies(code),
  quote_currency    TEXT NOT NULL REFERENCES currencies(code),
  rate              REAL NOT NULL,
  rate_type         TEXT NOT NULL DEFAULT 'MEAN',
  source            TEXT NOT NULL DEFAULT 'CBK',
  source_reference  TEXT,
  status            TEXT NOT NULL DEFAULT 'active',
  published_at      TEXT,
  effective_at      TEXT NOT NULL DEFAULT (datetime('now')),
  retrieved_at      TEXT NOT NULL DEFAULT (datetime('now')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_pair ON exchange_rates(base_currency, quote_currency);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_status ON exchange_rates(status);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_effective ON exchange_rates(effective_at);

-- Initial imported CBK indicative rate (129.76 as of 2 October 2026)
INSERT OR IGNORE INTO exchange_rates (
  id, base_currency, quote_currency, rate, rate_type, source, source_reference, status, published_at, effective_at
) VALUES (
  'fx-cbk-20261002-usdkes', 'USD', 'KES', 129.76, 'MEAN', 'CBK', 'https://www.centralbank.go.ke/forex/', 'active', '2026-10-02T00:00:00Z', '2026-10-02T00:00:00Z'
);

-- 3. FEE SCHEDULES
CREATE TABLE IF NOT EXISTS fee_schedules (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name            TEXT NOT NULL,
  version         TEXT NOT NULL DEFAULT '2026.1',
  academic_year   TEXT NOT NULL DEFAULT '2026-2027',
  base_currency   TEXT NOT NULL DEFAULT 'USD',
  status          TEXT NOT NULL DEFAULT 'active',
  effective_from  TEXT,
  effective_to    TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO fee_schedules (id, name, version, academic_year, base_currency, status, effective_from, effective_to)
VALUES ('fs_2026', '2026 Academic Fee Schedule', '2026.1', '2026-2027', 'USD', 'active', '2026-01-01T00:00:00Z', '2026-12-31T23:59:59Z');

-- 4. FEE GROUPS
CREATE TABLE IF NOT EXISTS fee_groups (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO fee_groups (id, code, name, description, display_order)
VALUES 
  ('fg_tuition', 'TUITION', 'Tuition Fees', 'Academic programme tuition fees', 1),
  ('fg_onboarding', 'STUDENT_ONBOARDING', 'Student Onboarding & Registration Package', 'Consolidated initial student onboarding fees', 2),
  ('fg_statutory', 'STATUTORY', 'Statutory Fees', 'Institutional statutory and optional facility charges', 3);

-- 5. FEE ITEMS
CREATE TABLE IF NOT EXISTS fee_items (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  fee_schedule_id     TEXT NOT NULL REFERENCES fee_schedules(id),
  fee_group_id        TEXT NOT NULL REFERENCES fee_groups(id),
  code                TEXT NOT NULL,
  name                TEXT NOT NULL,
  degree_level        TEXT,
  amount_base_minor   INTEGER NOT NULL,
  amount_base         REAL NOT NULL,
  base_currency       TEXT NOT NULL DEFAULT 'USD',
  billing_frequency   TEXT NOT NULL DEFAULT 'once',
  billing_periods     INTEGER NOT NULL DEFAULT 1,
  allocation_strategy TEXT NOT NULL DEFAULT 'DESCENDING_WHOLE_UNIT',
  trigger_event       TEXT,
  is_optional         INTEGER NOT NULL DEFAULT 0,
  is_configured       INTEGER NOT NULL DEFAULT 1,
  is_billable         INTEGER NOT NULL DEFAULT 1,
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fee_items_schedule ON fee_items(fee_schedule_id);
CREATE INDEX IF NOT EXISTS idx_fee_items_group    ON fee_items(fee_group_id);
CREATE INDEX IF NOT EXISTS idx_fee_items_level    ON fee_items(degree_level);
CREATE INDEX IF NOT EXISTS idx_fee_items_code     ON fee_items(code);

-- Seed Level Tuition Items
INSERT OR IGNORE INTO fee_items (id, fee_schedule_id, fee_group_id, code, name, degree_level, amount_base_minor, amount_base, base_currency, billing_frequency, billing_periods, allocation_strategy, trigger_event, is_optional, is_configured, is_billable)
VALUES
  ('fi_tui_cert', 'fs_2026', 'fg_tuition', 'TUITION_CERTIFICATE', 'Certificate Tuition', 'certificate', 15000, 150.00, 'USD', 'monthly', 6, 'DESCENDING_WHOLE_UNIT', 'term_enrollment', 0, 1, 1),
  ('fi_tui_dip', 'fs_2026', 'fg_tuition', 'TUITION_DIPLOMA', 'Diploma Tuition', 'diploma', 25000, 250.00, 'USD', 'per_semester', 4, 'DESCENDING_WHOLE_UNIT', 'term_enrollment', 0, 1, 1),
  ('fi_tui_ug', 'fs_2026', 'fg_tuition', 'TUITION_UNDERGRADUATE', 'Undergraduate Tuition', 'undergraduate', 100000, 1000.00, 'USD', 'per_semester', 12, 'DESCENDING_WHOLE_UNIT', 'term_enrollment', 0, 1, 1),
  ('fi_tui_grad', 'fs_2026', 'fg_tuition', 'TUITION_GRADUATE', 'Graduate / Master Tuition', 'graduate', 150000, 1500.00, 'USD', 'per_semester', 4, 'DESCENDING_WHOLE_UNIT', 'term_enrollment', 0, 1, 1),
  ('fi_tui_doc', 'fs_2026', 'fg_tuition', 'TUITION_DOCTORATE', 'Doctorate / PhD Tuition', 'doctorate', 200000, 2000.00, 'USD', 'per_semester', 4, 'DESCENDING_WHOLE_UNIT', 'term_enrollment', 0, 1, 1);

-- Seed Onboarding Package Items
INSERT OR IGNORE INTO fee_items (id, fee_schedule_id, fee_group_id, code, name, degree_level, amount_base_minor, amount_base, base_currency, billing_frequency, billing_periods, allocation_strategy, trigger_event, is_optional, is_configured, is_billable)
VALUES
  ('fi_onb_app', 'fs_2026', 'fg_onboarding', 'APPLICATION_FEE', 'Application Fee', NULL, 400, 4.00, 'USD', 'once', 1, 'SINGLE', 'application_submission', 0, 1, 1),
  ('fi_onb_reg', 'fs_2026', 'fg_onboarding', 'REGISTRATION_FEE', 'Registration Fee', NULL, 1600, 16.00, 'USD', 'once', 1, 'SINGLE', 'registration', 0, 1, 1),
  ('fi_onb_id',  'fs_2026', 'fg_onboarding', 'STUDENT_ID_FEE', 'Student ID Card Fee', NULL, 400, 4.00, 'USD', 'once', 1, 'SINGLE', 'id_issuance', 0, 1, 1);

-- Seed Statutory Items
INSERT OR IGNORE INTO fee_items (id, fee_schedule_id, fee_group_id, code, name, degree_level, amount_base_minor, amount_base, base_currency, billing_frequency, billing_periods, allocation_strategy, trigger_event, is_optional, is_configured, is_billable)
VALUES
  ('fi_stat_lab', 'fs_2026', 'fg_statutory', 'COMPUTER_LABS', 'Computer Labs & Internet', NULL, 0, 0.00, 'USD', 'per_semester', 1, 'SINGLE', 'manual', 1, 0, 0),
  ('fi_stat_grad', 'fs_2026', 'fg_statutory', 'GRADUATION', 'Graduation Fee', NULL, 0, 0.00, 'USD', 'once', 1, 'SINGLE', 'graduation_clearance', 0, 0, 0),
  ('fi_stat_lib', 'fs_2026', 'fg_statutory', 'LIBRARY', 'Library Fee', NULL, 0, 0.00, 'USD', 'per_semester', 1, 'SINGLE', 'manual', 0, 0, 0);

-- 6. FEE SCHEDULE INSTALLMENTS (Persisted descending integer allocations)
CREATE TABLE IF NOT EXISTS fee_schedule_installments (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  fee_schedule_id     TEXT NOT NULL REFERENCES fee_schedules(id),
  fee_item_id         TEXT NOT NULL REFERENCES fee_items(id),
  degree_level        TEXT NOT NULL,
  period_number       INTEGER NOT NULL,
  amount_base_minor   INTEGER NOT NULL,
  amount_base         REAL NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'USD',
  allocation_strategy TEXT NOT NULL DEFAULT 'DESCENDING_WHOLE_UNIT',
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(fee_item_id, period_number)
);

CREATE INDEX IF NOT EXISTS idx_fee_installments_level ON fee_schedule_installments(degree_level);

-- Certificate Installments ($150 total / 6 periods: 28, 27, 26, 25, 23, 21)
INSERT OR IGNORE INTO fee_schedule_installments (fee_schedule_id, fee_item_id, degree_level, period_number, amount_base_minor, amount_base, currency)
VALUES
  ('fs_2026', 'fi_tui_cert', 'certificate', 1, 2800, 28.00, 'USD'),
  ('fs_2026', 'fi_tui_cert', 'certificate', 2, 2700, 27.00, 'USD'),
  ('fs_2026', 'fi_tui_cert', 'certificate', 3, 2600, 26.00, 'USD'),
  ('fs_2026', 'fi_tui_cert', 'certificate', 4, 2500, 25.00, 'USD'),
  ('fs_2026', 'fi_tui_cert', 'certificate', 5, 2300, 23.00, 'USD'),
  ('fs_2026', 'fi_tui_cert', 'certificate', 6, 2100, 21.00, 'USD');

-- Diploma Installments ($250 total / 4 periods: 64, 63, 62, 61)
INSERT OR IGNORE INTO fee_schedule_installments (fee_schedule_id, fee_item_id, degree_level, period_number, amount_base_minor, amount_base, currency)
VALUES
  ('fs_2026', 'fi_tui_dip', 'diploma', 1, 6400, 64.00, 'USD'),
  ('fs_2026', 'fi_tui_dip', 'diploma', 2, 6300, 63.00, 'USD'),
  ('fs_2026', 'fi_tui_dip', 'diploma', 3, 6200, 62.00, 'USD'),
  ('fs_2026', 'fi_tui_dip', 'diploma', 4, 6100, 61.00, 'USD');

-- Undergraduate Installments ($1,000 total / 12 periods: 89, 88, 87, 86, 85, 84, 83, 82, 81, 80, 78, 77)
INSERT OR IGNORE INTO fee_schedule_installments (fee_schedule_id, fee_item_id, degree_level, period_number, amount_base_minor, amount_base, currency)
VALUES
  ('fs_2026', 'fi_tui_ug', 'undergraduate', 1, 8900, 89.00, 'USD'),
  ('fs_2026', 'fi_tui_ug', 'undergraduate', 2, 8800, 88.00, 'USD'),
  ('fs_2026', 'fi_tui_ug', 'undergraduate', 3, 8700, 87.00, 'USD'),
  ('fs_2026', 'fi_tui_ug', 'undergraduate', 4, 8600, 86.00, 'USD'),
  ('fs_2026', 'fi_tui_ug', 'undergraduate', 5, 8500, 85.00, 'USD'),
  ('fs_2026', 'fi_tui_ug', 'undergraduate', 6, 8400, 84.00, 'USD'),
  ('fs_2026', 'fi_tui_ug', 'undergraduate', 7, 8300, 83.00, 'USD'),
  ('fs_2026', 'fi_tui_ug', 'undergraduate', 8, 8200, 82.00, 'USD'),
  ('fs_2026', 'fi_tui_ug', 'undergraduate', 9, 8100, 81.00, 'USD'),
  ('fs_2026', 'fi_tui_ug', 'undergraduate', 10, 8000, 80.00, 'USD'),
  ('fs_2026', 'fi_tui_ug', 'undergraduate', 11, 7800, 78.00, 'USD'),
  ('fs_2026', 'fi_tui_ug', 'undergraduate', 12, 7700, 77.00, 'USD');

-- Graduate Installments ($1,500 total / 4 periods: 378, 377, 376, 369)
INSERT OR IGNORE INTO fee_schedule_installments (fee_schedule_id, fee_item_id, degree_level, period_number, amount_base_minor, amount_base, currency)
VALUES
  ('fs_2026', 'fi_tui_grad', 'graduate', 1, 37800, 378.00, 'USD'),
  ('fs_2026', 'fi_tui_grad', 'graduate', 2, 37700, 377.00, 'USD'),
  ('fs_2026', 'fi_tui_grad', 'graduate', 3, 37600, 376.00, 'USD'),
  ('fs_2026', 'fi_tui_grad', 'graduate', 4, 36900, 369.00, 'USD');

-- Doctorate Installments ($2,000 total / 4 periods: 503, 502, 501, 494)
INSERT OR IGNORE INTO fee_schedule_installments (fee_schedule_id, fee_item_id, degree_level, period_number, amount_base_minor, amount_base, currency)
VALUES
  ('fs_2026', 'fi_tui_doc', 'doctorate', 1, 50300, 503.00, 'USD'),
  ('fs_2026', 'fi_tui_doc', 'doctorate', 2, 50200, 502.00, 'USD'),
  ('fs_2026', 'fi_tui_doc', 'doctorate', 3, 50100, 501.00, 'USD'),
  ('fs_2026', 'fi_tui_doc', 'doctorate', 4, 49400, 494.00, 'USD');

-- 7. EVOLVE INVOICES TABLE (Add missing financial columns)
ALTER TABLE invoices ADD COLUMN invoice_number TEXT;
ALTER TABLE invoices ADD COLUMN programme_id TEXT;
ALTER TABLE invoices ADD COLUMN degree_level TEXT;
ALTER TABLE invoices ADD COLUMN fee_schedule_id TEXT;
ALTER TABLE invoices ADD COLUMN academic_year TEXT;
ALTER TABLE invoices ADD COLUMN period_number INTEGER;
ALTER TABLE invoices ADD COLUMN base_currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE invoices ADD COLUMN billing_currency TEXT NOT NULL DEFAULT 'KES';
ALTER TABLE invoices ADD COLUMN exchange_rate REAL;
ALTER TABLE invoices ADD COLUMN exchange_rate_id TEXT;
ALTER TABLE invoices ADD COLUMN exchange_rate_source TEXT DEFAULT 'CBK';
ALTER TABLE invoices ADD COLUMN exchange_rate_effective_at TEXT;
ALTER TABLE invoices ADD COLUMN subtotal_base REAL;
ALTER TABLE invoices ADD COLUMN subtotal_billing REAL;
ALTER TABLE invoices ADD COLUMN discount REAL NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN adjustment REAL NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN total_base REAL;
ALTER TABLE invoices ADD COLUMN total_billing REAL;
ALTER TABLE invoices ADD COLUMN paid_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN balance REAL;
ALTER TABLE invoices ADD COLUMN issue_date TEXT;
ALTER TABLE invoices ADD COLUMN updated_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number_unique ON invoices(invoice_number);

-- 8. INVOICE LINES
CREATE TABLE IF NOT EXISTS invoice_lines (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  invoice_id          TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  fee_item_id         TEXT REFERENCES fee_items(id),
  fee_group_id        TEXT REFERENCES fee_groups(id),
  description         TEXT NOT NULL,
  quantity            INTEGER NOT NULL DEFAULT 1,
  unit_amount_base    REAL NOT NULL,
  base_currency       TEXT NOT NULL DEFAULT 'USD',
  unit_amount_billing REAL NOT NULL,
  billing_currency    TEXT NOT NULL DEFAULT 'KES',
  exchange_rate       REAL NOT NULL,
  period_number       INTEGER,
  term_id             TEXT,
  line_total_base     REAL NOT NULL,
  line_total_billing  REAL NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);

-- 9. PAYMENTS
CREATE TABLE IF NOT EXISTS payments (
  id                      TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  payment_reference       TEXT NOT NULL UNIQUE,
  student_id              TEXT NOT NULL,
  uid                     TEXT,
  provider                TEXT NOT NULL DEFAULT 'paystack',
  channel                 TEXT,
  amount                  REAL NOT NULL,
  currency                TEXT NOT NULL,
  amount_base_equivalent  REAL,
  exchange_rate           REAL,
  exchange_rate_source    TEXT,
  status                  TEXT NOT NULL DEFAULT 'pending',
  provider_status         TEXT,
  raw_response            TEXT,
  paid_at                 TEXT,
  created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_payments_status  ON payments(status);

-- 10. PAYMENT ALLOCATIONS
CREATE TABLE IF NOT EXISTS payment_allocations (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  payment_id        TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id        TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  invoice_line_id   TEXT REFERENCES invoice_lines(id),
  allocated_amount  REAL NOT NULL,
  currency          TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_allocations_payment ON payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_allocations_invoice ON payment_allocations(invoice_id);

-- 11. FINANCIAL AUDIT LOG
CREATE TABLE IF NOT EXISTS financial_audit_log (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  action      TEXT NOT NULL,
  actor_id    TEXT,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  reason      TEXT,
  source      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fin_audit_action ON financial_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_fin_audit_target ON financial_audit_log(target_type, target_id);

-- 12. FINANCIAL ADJUSTMENTS
CREATE TABLE IF NOT EXISTS financial_adjustments (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  student_id      TEXT NOT NULL,
  invoice_id      TEXT REFERENCES invoices(id),
  adjustment_type TEXT NOT NULL,
  amount          REAL NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USD',
  reason          TEXT NOT NULL,
  approved_by     TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fin_adj_student ON financial_adjustments(student_id);
CREATE INDEX IF NOT EXISTS idx_fin_adj_invoice ON financial_adjustments(invoice_id);

-- 13. APP CONFIG DEFAULTS FOR FINANCE
INSERT OR IGNORE INTO app_config (key, value) VALUES
  ('fx_rate_source', 'CBK'),
  ('fx_rate_max_age_hours', '72'),
  ('fx_rate_stale_policy', 'BLOCK_NEW_INVOICE'),
  ('default_billing_market', 'KE'),
  ('base_currency', 'USD');
