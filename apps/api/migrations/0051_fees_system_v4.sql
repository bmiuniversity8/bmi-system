-- Migration: 0051_fees_system_v4
-- BMI Fees System v4: Standard Price Book, Aid Rate Cards, Integer Minor Units,
-- Gateway Deferral, Harmonized Clearance, Double-Entry Ledger and Governance.

-- 1. CURRENCIES & FX
CREATE TABLE IF NOT EXISTS currencies_v4 (
  code                         TEXT PRIMARY KEY,
  name                         TEXT NOT NULL,
  symbol                       TEXT NOT NULL,
  minor_unit_exponent          INTEGER NOT NULL DEFAULT 2,
  fx_rounding_increment_minor  INTEGER NOT NULL DEFAULT 1,
  instalment_rounding_minor    INTEGER NOT NULL DEFAULT 1,
  gateway_enabled              INTEGER NOT NULL DEFAULT 0,
  is_base                      INTEGER NOT NULL DEFAULT 0,
  is_active                    INTEGER NOT NULL DEFAULT 1,
  created_at                   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fx_rates_v4 (
  id             TEXT PRIMARY KEY,
  base_currency  TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  rate_micros    INTEGER NOT NULL,
  effective_from TEXT,
  effective_to   TEXT,
  status         TEXT NOT NULL DEFAULT 'draft',
  source         TEXT NOT NULL DEFAULT 'CBK',
  set_by         TEXT,
  approved_by    TEXT,
  approved_at    TEXT,
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fx_rates_v4_pair ON fx_rates_v4(base_currency, quote_currency);
CREATE INDEX IF NOT EXISTS idx_fx_rates_v4_status ON fx_rates_v4(status);

-- 2. STANDARD PRICE BOOK: FEE LEVELS, ITEMS, PLANS, LINES, TIERS
CREATE TABLE IF NOT EXISTS fee_levels (
  id           TEXT PRIMARY KEY,
  level_key    TEXT NOT NULL UNIQUE,
  label        TEXT NOT NULL,
  public_label TEXT NOT NULL,
  is_billable  INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fee_items_v4 (
  id                TEXT PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  category          TEXT NOT NULL,
  charge_event      TEXT NOT NULL,
  charge_scope      TEXT NOT NULL,
  applies_to_levels TEXT NOT NULL DEFAULT '[]',
  is_optional       INTEGER NOT NULL DEFAULT 0,
  is_refundable     INTEGER,
  is_active         INTEGER NOT NULL DEFAULT 1,
  published         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fee_plans_v4 (
  id                 TEXT PRIMARY KEY,
  fee_level_id       TEXT NOT NULL REFERENCES fee_levels(id),
  code               TEXT NOT NULL,
  version            TEXT NOT NULL DEFAULT 'v1',
  status             TEXT NOT NULL DEFAULT 'draft',
  effective_from     TEXT,
  effective_to       TEXT,
  duration_months    INTEGER,
  instalment_cadence TEXT,
  instalment_count   INTEGER,
  created_by         TEXT,
  approved_by        TEXT,
  approved_at        TEXT,
  created_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fee_plan_lines_v4 (
  id           TEXT PRIMARY KEY,
  fee_plan_id  TEXT NOT NULL REFERENCES fee_plans_v4(id),
  fee_item_id  TEXT NOT NULL REFERENCES fee_items_v4(id),
  charge_basis TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fee_tiers_v4 (
  id               TEXT PRIMARY KEY,
  fee_plan_line_id TEXT NOT NULL REFERENCES fee_plan_lines_v4(id),
  label            TEXT NOT NULL,
  min_credits      REAL NOT NULL,
  max_credits      REAL,
  amount_minor     INTEGER NOT NULL,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_plan_options_v4 (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  schedule_json TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fee_pins (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  application_id   TEXT,
  fee_plan_id      TEXT NOT NULL REFERENCES fee_plans_v4(id),
  fee_plan_version TEXT NOT NULL,
  fx_rate_id       TEXT,
  pinned_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fee_pins_user ON fee_pins(user_id);
CREATE INDEX IF NOT EXISTS idx_fee_pins_app ON fee_pins(application_id);

-- 3. SETTINGS & INSTITUTION POLICY
CREATE TABLE IF NOT EXISTS finance_settings (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL,
  value_type  TEXT NOT NULL,
  description TEXT,
  updated_by  TEXT,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS finance_settings_history (
  id             TEXT PRIMARY KEY,
  key            TEXT NOT NULL,
  old_value_json TEXT,
  new_value_json TEXT NOT NULL,
  updated_by     TEXT,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS institution_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  description TEXT,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS refund_rules (
  id                  TEXT PRIMARY KEY,
  fee_item_id         TEXT,
  category            TEXT,
  days_from_start_min INTEGER,
  days_from_start_max INTEGER,
  percent             INTEGER NOT NULL,
  created_at          TEXT NOT NULL
);

-- 4. INVOICES, LINES & IDEMPOTENT FEE CHARGES
CREATE TABLE IF NOT EXISTS invoices_v4 (
  id                          TEXT PRIMARY KEY,
  invoice_number              TEXT NOT NULL UNIQUE,
  idempotency_key             TEXT NOT NULL UNIQUE,
  kind                        TEXT NOT NULL,
  source_event                TEXT NOT NULL,
  legacy                      INTEGER NOT NULL DEFAULT 0,
  user_id                     TEXT NOT NULL,
  student_id                  TEXT,
  uid                         TEXT,
  application_id              TEXT,
  enrollment_key              TEXT,
  term_id                     TEXT,
  academic_year               TEXT,
  fee_level_id                TEXT,
  fee_plan_id                 TEXT,
  fee_plan_version            TEXT,
  instalment_no               INTEGER,
  instalment_of               INTEGER,
  plan_group_id               TEXT,

  base_currency               TEXT NOT NULL,
  base_subtotal_minor         INTEGER NOT NULL,
  base_discount_minor         INTEGER NOT NULL DEFAULT 0,
  base_tax_minor              INTEGER NOT NULL DEFAULT 0,
  base_total_minor            INTEGER NOT NULL,
  base_paid_minor             INTEGER NOT NULL DEFAULT 0,

  charge_currency             TEXT NOT NULL,
  subtotal_minor              INTEGER NOT NULL,
  discount_minor              INTEGER NOT NULL DEFAULT 0,
  tax_minor                   INTEGER NOT NULL DEFAULT 0,
  total_minor                 INTEGER NOT NULL,
  paid_minor                  INTEGER NOT NULL DEFAULT 0,
  balance_minor               INTEGER NOT NULL,

  fx_rate_id                  TEXT,
  fx_rate_micros              INTEGER NOT NULL,
  fx_rounding_increment_minor INTEGER NOT NULL DEFAULT 1,
  tax_rate_bps                INTEGER,

  status                      TEXT NOT NULL DEFAULT 'issued',
  due_date                    TEXT NOT NULL,
  issued_at                   TEXT NOT NULL,
  paid_at                     TEXT,
  voided_at                   TEXT,
  void_reason                 TEXT,

  billing_name                TEXT,
  billing_email               TEXT,
  billing_address             TEXT,
  student_number              TEXT,
  programme_name              TEXT,
  level_key                   TEXT,
  level_label                 TEXT,
  notes                       TEXT,

  created_by                  TEXT NOT NULL,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invoices_v4_user ON invoices_v4(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_v4_term ON invoices_v4(term_id);
CREATE INDEX IF NOT EXISTS idx_invoices_v4_status ON invoices_v4(status);
CREATE INDEX IF NOT EXISTS idx_invoices_v4_enrollment ON invoices_v4(enrollment_key);

CREATE TABLE IF NOT EXISTS invoice_lines_v4 (
  id                TEXT PRIMARY KEY,
  invoice_id        TEXT NOT NULL REFERENCES invoices_v4(id),
  line_no           INTEGER NOT NULL,
  fee_item_id       TEXT NOT NULL REFERENCES fee_items_v4(id),
  kind              TEXT NOT NULL,
  description       TEXT NOT NULL,
  quantity          REAL NOT NULL DEFAULT 1,
  course_id         TEXT,
  base_unit_minor   INTEGER NOT NULL,
  base_amount_minor INTEGER NOT NULL,
  unit_minor        INTEGER NOT NULL,
  amount_minor      INTEGER NOT NULL,
  award_id          TEXT,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_v4_invoice ON invoice_lines_v4(invoice_id);

CREATE TABLE IF NOT EXISTS fee_charges (
  id          TEXT PRIMARY KEY,
  charge_key  TEXT NOT NULL,
  fee_item_id TEXT NOT NULL REFERENCES fee_items_v4(id),
  invoice_id  TEXT NOT NULL REFERENCES invoices_v4(id),
  status      TEXT NOT NULL DEFAULT 'billed',
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_charges_billed ON fee_charges(charge_key) WHERE status = 'billed';

-- 5. PAYMENTS, ALLOCATIONS, CREDITS, RECEIPTS, SEQUENCES
CREATE TABLE IF NOT EXISTS payments_v4 (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  gateway           TEXT NOT NULL DEFAULT 'paystack',
  gateway_reference TEXT NOT NULL UNIQUE,
  gateway_event_id  TEXT,
  charge_currency   TEXT NOT NULL,
  amount_minor      INTEGER NOT NULL,
  channel           TEXT,
  gateway_fee_minor INTEGER,
  status            TEXT NOT NULL DEFAULT 'pending',
  paid_at           TEXT,
  raw_payload_hash  TEXT,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_v4_user ON payments_v4(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_v4_status ON payments_v4(status);

CREATE TABLE IF NOT EXISTS payment_allocations_v4 (
  id                TEXT PRIMARY KEY,
  payment_id        TEXT NOT NULL REFERENCES payments_v4(id),
  invoice_id        TEXT NOT NULL REFERENCES invoices_v4(id),
  amount_minor      INTEGER NOT NULL,
  base_amount_minor INTEGER NOT NULL,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_alloc_v4_pay ON payment_allocations_v4(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_alloc_v4_inv ON payment_allocations_v4(invoice_id);

CREATE TABLE IF NOT EXISTS account_credits_v4 (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  currency          TEXT NOT NULL,
  amount_minor      INTEGER NOT NULL,
  source_payment_id TEXT,
  status            TEXT NOT NULL DEFAULT 'available',
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS receipts_v4 (
  id             TEXT PRIMARY KEY,
  receipt_number TEXT NOT NULL UNIQUE,
  payment_id     TEXT NOT NULL REFERENCES payments_v4(id),
  issued_at      TEXT NOT NULL,
  document_key   TEXT
);

CREATE TABLE IF NOT EXISTS refunds_v4 (
  id                       TEXT PRIMARY KEY,
  invoice_id               TEXT NOT NULL REFERENCES invoices_v4(id),
  payment_id               TEXT NOT NULL REFERENCES payments_v4(id),
  amount_minor             INTEGER NOT NULL,
  reason                   TEXT NOT NULL,
  requested_by             TEXT NOT NULL,
  approved_by              TEXT,
  gateway_refund_reference TEXT,
  status                   TEXT NOT NULL DEFAULT 'pending',
  created_at               TEXT NOT NULL,
  approved_at              TEXT
);

CREATE TABLE IF NOT EXISTS document_sequences (
  name       TEXT NOT NULL,
  year       INTEGER NOT NULL,
  next_value INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (name, year)
);

CREATE TABLE IF NOT EXISTS payment_webhook_events_v4 (
  event_id     TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  received_at  TEXT NOT NULL,
  processed_at TEXT,
  status       TEXT NOT NULL DEFAULT 'received'
);

CREATE TABLE IF NOT EXISTS fee_gate_deferrals (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  invoice_id  TEXT NOT NULL REFERENCES invoices_v4(id),
  gate        TEXT NOT NULL,
  deferred_at TEXT NOT NULL,
  policy      TEXT NOT NULL,
  cleared_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_deferrals_user ON fee_gate_deferrals(user_id);
CREATE INDEX IF NOT EXISTS idx_deferrals_gate ON fee_gate_deferrals(gate);

-- 6. DOUBLE-ENTRY LEDGER
CREATE TABLE IF NOT EXISTS ledger_accounts_v4 (
  id             TEXT PRIMARY KEY,
  account_code   TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL,
  normal_balance TEXT NOT NULL,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_entries_v4 (
  id           TEXT PRIMARY KEY,
  journal_id   TEXT NOT NULL,
  account_code TEXT NOT NULL REFERENCES ledger_accounts_v4(account_code),
  debit_minor  INTEGER NOT NULL DEFAULT 0,
  credit_minor INTEGER NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL,
  invoice_id   TEXT,
  payment_id   TEXT,
  term_id      TEXT,
  description  TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_journal ON ledger_entries_v4(journal_id);
CREATE INDEX IF NOT EXISTS idx_ledger_invoice ON ledger_entries_v4(invoice_id);

-- 7. FINANCIAL AID, RATE CARDS & NON-DISCRIMINATION SUBSIDY
CREATE TABLE IF NOT EXISTS rate_cards (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_card_lines (
  id                         TEXT PRIMARY KEY,
  rate_card_id               TEXT NOT NULL REFERENCES rate_cards(id),
  fee_level_id               TEXT NOT NULL REFERENCES fee_levels(id),
  fee_item_id                TEXT NOT NULL REFERENCES fee_items_v4(id),
  amount_minor               INTEGER NOT NULL,
  duration_months            INTEGER,
  instalment_count           INTEGER,
  instalment_structure_json  TEXT,
  created_at                 TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS aid_funds (
  id                TEXT PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  budget_base_minor INTEGER NOT NULL DEFAULT 0,
  period_from       TEXT,
  period_to         TEXT,
  restricted_to     TEXT,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS aid_programmes (
  id                   TEXT PRIMARY KEY,
  code                 TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  kind                 TEXT NOT NULL,
  method               TEXT NOT NULL,
  invoice_label        TEXT NOT NULL,
  public_criteria_text TEXT NOT NULL,
  stackable            INTEGER NOT NULL DEFAULT 0,
  renewable            INTEGER NOT NULL DEFAULT 1,
  requires_sap         INTEGER NOT NULL DEFAULT 1,
  status               TEXT NOT NULL DEFAULT 'draft',
  fund_id              TEXT REFERENCES aid_funds(id),
  created_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS aid_bands (
  id               TEXT PRIMARY KEY,
  aid_programme_id TEXT NOT NULL REFERENCES aid_programmes(id),
  band_label       TEXT NOT NULL,
  sort_order       INTEGER NOT NULL,
  min_need_score   REAL NOT NULL,
  max_need_score   REAL NOT NULL,
  method           TEXT NOT NULL,
  percent_bps      INTEGER,
  rate_card_id     TEXT REFERENCES rate_cards(id),
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS aid_commitments (
  id                  TEXT PRIMARY KEY,
  award_id            TEXT NOT NULL,
  fund_id             TEXT NOT NULL REFERENCES aid_funds(id),
  committed_base_minor INTEGER NOT NULL,
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS aid_applications (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  aid_programme_id    TEXT NOT NULL REFERENCES aid_programmes(id),
  status              TEXT NOT NULL DEFAULT 'submitted',
  submitted_at        TEXT NOT NULL,
  need_score          REAL,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  documents           TEXT,
  minimal_data_json   TEXT,
  waitlist_rank       INTEGER,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_aid_app_user ON aid_applications(user_id);

CREATE TABLE IF NOT EXISTS fee_awards (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL,
  aid_programme_id   TEXT NOT NULL REFERENCES aid_programmes(id),
  aid_application_id TEXT REFERENCES aid_applications(id),
  method             TEXT NOT NULL,
  percent_bps        INTEGER,
  fixed_base_minor   INTEGER,
  rate_card_id       TEXT REFERENCES rate_cards(id),
  applies_to_json    TEXT NOT NULL,
  valid_from_term    TEXT,
  valid_to_term      TEXT,
  renewal_due        TEXT,
  conditions_json    TEXT,
  status             TEXT NOT NULL DEFAULT 'proposed',
  reason_code        TEXT,
  decided_by         TEXT NOT NULL,
  second_approver    TEXT,
  decided_at         TEXT NOT NULL,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fee_awards_user ON fee_awards(user_id);

CREATE TABLE IF NOT EXISTS aid_appeals (
  id                       TEXT PRIMARY KEY,
  award_or_application_id  TEXT NOT NULL,
  filed_at                 TEXT NOT NULL,
  reviewer_id              TEXT NOT NULL,
  outcome                  TEXT,
  written_reason           TEXT,
  resolved_at              TEXT
);

CREATE TABLE IF NOT EXISTS aid_access_log (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  accessed_by TEXT NOT NULL,
  action      TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  accessed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS aid_criteria_fields (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  is_allowed INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- ─── SEED DATA ───────────────────────────────────────────────────────────────

-- Currencies
INSERT OR IGNORE INTO currencies_v4 (code, name, symbol, minor_unit_exponent, fx_rounding_increment_minor, instalment_rounding_minor, gateway_enabled, is_base, is_active, created_at)
VALUES 
  ('USD', 'US Dollar', '$', 2, 1, 1, 0, 1, 1, '2026-10-06T00:00:00Z'),
  ('KES', 'Kenyan Shilling', 'KSh', 2, 1000, 100, 0, 0, 1, '2026-10-06T00:00:00Z');

-- FX Rate (draft, rate 130 KES per USD)
INSERT OR IGNORE INTO fx_rates_v4 (id, base_currency, quote_currency, rate_micros, status, source, created_at)
VALUES ('fx_rate_usd_kes_initial', 'USD', 'KES', 130000000, 'draft', 'CBK', '2026-10-06T00:00:00Z');

-- Fee Levels
INSERT OR IGNORE INTO fee_levels (id, level_key, label, public_label, is_billable, sort_order, created_at)
VALUES
  ('lvl_cert', 'certificate', 'Graduate Certificate', 'Graduate Certificates', 1, 1, '2026-10-06T00:00:00Z'),
  ('lvl_dip', 'diploma', 'Diploma', 'Diploma Programmes', 1, 2, '2026-10-06T00:00:00Z'),
  ('lvl_ug', 'undergraduate', 'Undergraduate', 'Undergraduate / Bachelor''s Degrees', 1, 3, '2026-10-06T00:00:00Z'),
  ('lvl_grad', 'graduate', 'Graduate', 'Graduate / Master''s Degrees', 1, 4, '2026-10-06T00:00:00Z'),
  ('lvl_doc', 'doctorate', 'Doctorate', 'Doctorate Degrees', 1, 5, '2026-10-06T00:00:00Z');

-- Fee Items (No ID fee item, no computer/library items)
INSERT OR IGNORE INTO fee_items_v4 (id, code, name, category, charge_event, charge_scope, applies_to_levels, is_optional, is_refundable, is_active, published, created_at)
VALUES
  ('fi_tui_credit', 'TUI-CREDIT', 'Tuition (Per Credit Hour)', 'tuition', 'course_registration', 'per_credit_hour', '["certificate","undergraduate","graduate","doctorate"]', 0, NULL, 1, 1, '2026-10-06T00:00:00Z'),
  ('fi_tui_diploma', 'TUI-DIPLOMA', 'Diploma Programme Tuition', 'tuition', 'course_registration', 'per_term', '["diploma"]', 0, NULL, 1, 1, '2026-10-06T00:00:00Z'),
  ('fi_app', 'APP-FEE', 'Application Fee (Non-refundable)', 'application', 'application_submit', 'once_per_application', '[]', 0, 0, 1, 1, '2026-10-06T00:00:00Z'),
  ('fi_reg', 'REG-FEE', 'Registration (matriculation) Fee', 'registration', 'offer_acceptance', 'once_per_enrollment', '[]', 0, 0, 1, 1, '2026-10-06T00:00:00Z'),
  ('fi_grad', 'GRAD-FEE', 'Graduation Fee', 'graduation', 'graduation_clearance', 'once_per_enrollment', '[]', 0, NULL, 1, 1, '2026-10-06T00:00:00Z'),
  ('fi_thesis', 'THESIS-FEE', 'Thesis Fee', 'thesis', 'thesis_registration', 'once_per_enrollment', '["graduate"]', 0, NULL, 1, 1, '2026-10-06T00:00:00Z'),
  ('fi_diss', 'DISS-FEE', 'Dissertation Fee', 'dissertation', 'dissertation_registration', 'once_per_enrollment', '["doctorate"]', 0, NULL, 1, 1, '2026-10-06T00:00:00Z'),
  ('fi_audit', 'AUDIT-FEE', 'Audit Fee', 'audit', 'course_audit_registration', 'per_course', '[]', 0, NULL, 1, 1, '2026-10-06T00:00:00Z'),
  ('fi_pla', 'PLA-FEE', 'Life Learning Credit Assessment', 'pla', 'pla_assessment_request', 'per_credit_hour', '[]', 0, NULL, 1, 1, '2026-10-06T00:00:00Z'),
  ('fi_xfer', 'XFER-FEE', 'Transfer Credit Fee', 'transfer_credit', 'transfer_credit_posting', 'per_posting', '[]', 0, NULL, 1, 1, '2026-10-06T00:00:00Z');

-- Standard Fee Plans (Initial draft standard plans)
INSERT OR IGNORE INTO fee_plans_v4 (id, fee_level_id, code, version, status, instalment_cadence, instalment_count, created_at)
VALUES
  ('fp_cert_std', 'lvl_cert', 'PLAN-CERT-STD', 'v1', 'draft', 'per_term', 2, '2026-10-06T00:00:00Z'),
  ('fp_dip_std', 'lvl_dip', 'PLAN-DIP-STD', 'v1', 'draft', 'per_term', 4, '2026-10-06T00:00:00Z'),
  ('fp_ug_std', 'lvl_ug', 'PLAN-UG-STD', 'v1', 'draft', 'per_term', 8, '2026-10-06T00:00:00Z'),
  ('fp_grad_std', 'lvl_grad', 'PLAN-GRAD-STD', 'v1', 'draft', 'per_term', 4, '2026-10-06T00:00:00Z'),
  ('fp_doc_std', 'lvl_doc', 'PLAN-DOC-STD', 'v1', 'draft', 'per_term', 6, '2026-10-06T00:00:00Z');

-- Fee Plan Lines (Standard prices in USD minor units)
INSERT OR IGNORE INTO fee_plan_lines_v4 (id, fee_plan_id, fee_item_id, charge_basis, amount_minor, created_at)
VALUES
  -- Certificate: $300 / credit hour
  ('fpl_cert_tui', 'fp_cert_std', 'fi_tui_credit', 'per_credit_hour', 30000, '2026-10-06T00:00:00Z'),
  -- Diploma: $10,000 flat programme total ($2,500 per term for 4 terms)
  ('fpl_dip_tui', 'fp_dip_std', 'fi_tui_diploma', 'flat', 1000000, '2026-10-06T00:00:00Z'),
  -- Undergraduate: $250 / credit hour
  ('fpl_ug_tui', 'fp_ug_std', 'fi_tui_credit', 'per_credit_hour', 25000, '2026-10-06T00:00:00Z'),
  -- Graduate: $350 / credit hour
  ('fpl_grad_tui', 'fp_grad_std', 'fi_tui_credit', 'per_credit_hour', 35000, '2026-10-06T00:00:00Z'),
  -- Doctorate: $450 / credit hour
  ('fpl_doc_tui', 'fp_doc_std', 'fi_tui_credit', 'per_credit_hour', 45000, '2026-10-06T00:00:00Z'),
  -- General lines across undergraduate plan
  ('fpl_ug_app', 'fp_ug_std', 'fi_app', 'flat', 5000, '2026-10-06T00:00:00Z'),
  ('fpl_ug_reg', 'fp_ug_std', 'fi_reg', 'flat', 5000, '2026-10-06T00:00:00Z'),
  ('fpl_ug_grad', 'fp_ug_std', 'fi_grad', 'flat', 15000, '2026-10-06T00:00:00Z'),
  ('fpl_ug_audit', 'fp_ug_std', 'fi_audit', 'per_course', 10000, '2026-10-06T00:00:00Z'),
  ('fpl_ug_pla', 'fp_ug_std', 'fi_pla', 'per_credit_hour', 7000, '2026-10-06T00:00:00Z'),
  ('fpl_ug_xfer', 'fp_ug_std', 'fi_xfer', 'tiered_by_credits', 0, '2026-10-06T00:00:00Z'),
  -- Thesis fee on graduate plan ($300)
  ('fpl_grad_thesis', 'fp_grad_std', 'fi_thesis', 'flat', 30000, '2026-10-06T00:00:00Z'),
  -- Dissertation fee on doctorate plan ($400)
  ('fpl_doc_diss', 'fp_doc_std', 'fi_diss', 'flat', 40000, '2026-10-06T00:00:00Z');

-- Transfer credit tiers
INSERT OR IGNORE INTO fee_tiers_v4 (id, fee_plan_line_id, label, min_credits, max_credits, amount_minor, created_at)
VALUES
  ('ft_xfer_1', 'fpl_ug_xfer', 'Less than 30 credits', 0, 29.99, 5000, '2026-10-06T00:00:00Z'),
  ('ft_xfer_2', 'fpl_ug_xfer', '30 to 60 credits', 30, 60.00, 10000, '2026-10-06T00:00:00Z'),
  ('ft_xfer_3', 'fpl_ug_xfer', '61 to 90 credits', 60.01, 90.00, 15000, '2026-10-06T00:00:00Z'),
  ('ft_xfer_4', 'fpl_ug_xfer', 'More than 90 credits', 90.01, NULL, 20000, '2026-10-06T00:00:00Z');

-- Payment Plan Options (Pay In Full standard)
INSERT OR IGNORE INTO payment_plan_options_v4 (id, code, name, schedule_json, is_active, created_at)
VALUES
  ('ppo_full', 'FULL', 'Single Full Payment', '[{"percent_bps": 10000, "due_offset_days": 0}]', 1, '2026-10-06T00:00:00Z'),
  ('ppo_install_2', 'INSTALLMENTS_2', 'Two Instalments (50% upfront, 50% midterm)', '[{"percent_bps": 5000, "due_offset_days": 0}, {"percent_bps": 5000, "due_offset_days": 45}]', 1, '2026-10-06T00:00:00Z'),
  ('ppo_install_3', 'INSTALLMENTS_3', 'Three Instalments (33% upfront, 33% midterm, 34% final)', '[{"percent_bps": 3333, "due_offset_days": 0}, {"percent_bps": 3333, "due_offset_days": 30}, {"percent_bps": 3334, "due_offset_days": 60}]', 1, '2026-10-06T00:00:00Z');

-- Access Rate Card (Band A fee sheet subsidy)
INSERT OR IGNORE INTO rate_cards (id, code, name, status, created_at)
VALUES ('rc_access', 'ACCESS-RATE-CARD', 'Subsidized Access Rate Card (Band A)', 'draft', '2026-10-06T00:00:00Z');

INSERT OR IGNORE INTO rate_card_lines (id, rate_card_id, fee_level_id, fee_item_id, amount_minor, duration_months, instalment_count, instalment_structure_json, created_at)
VALUES
  -- Certificate: USD 150 total (KES 19,500 @ 130)
  ('rcl_cert_tui', 'rc_access', 'lvl_cert', 'fi_tui_credit', 15000, 6, 2, '[{"amount_minor": 7500}, {"amount_minor": 7500}]', '2026-10-06T00:00:00Z'),
  -- Diploma: USD 250 total (KES 32,500 @ 130)
  ('rcl_dip_tui', 'rc_access', 'lvl_dip', 'fi_tui_diploma', 25000, 12, 4, '[{"amount_minor": 6250}, {"amount_minor": 6250}, {"amount_minor": 6250}, {"amount_minor": 6250}]', '2026-10-06T00:00:00Z'),
  -- Undergraduate: USD 1,000 total (KES 130,000 @ 130), 12 instalments: 11 x 83.33 + 83.37
  ('rcl_ug_tui', 'rc_access', 'lvl_ug', 'fi_tui_credit', 100000, 30, 12, '[{"amount_minor": 8333}, {"amount_minor": 8333}, {"amount_minor": 8333}, {"amount_minor": 8333}, {"amount_minor": 8333}, {"amount_minor": 8333}, {"amount_minor": 8333}, {"amount_minor": 8333}, {"amount_minor": 8333}, {"amount_minor": 8333}, {"amount_minor": 8333}, {"amount_minor": 8337}]', '2026-10-06T00:00:00Z'),
  -- Graduate: USD 1,500 total (KES 195,000 @ 130)
  ('rcl_grad_tui', 'rc_access', 'lvl_grad', 'fi_tui_credit', 150000, 24, 6, '[{"amount_minor": 25000}, {"amount_minor": 25000}, {"amount_minor": 25000}, {"amount_minor": 25000}, {"amount_minor": 25000}, {"amount_minor": 25000}]', '2026-10-06T00:00:00Z'),
  -- Doctorate: USD 2,000 total (KES 260,000 @ 130)
  ('rcl_doc_tui', 'rc_access', 'lvl_doc', 'fi_tui_credit', 200000, 36, 8, '[{"amount_minor": 25000}, {"amount_minor": 25000}, {"amount_minor": 25000}, {"amount_minor": 25000}, {"amount_minor": 25000}, {"amount_minor": 25000}, {"amount_minor": 25000}, {"amount_minor": 25000}]', '2026-10-06T00:00:00Z'),
  -- Once-off fees on Rate Card: Application 3.85 (KES 500 @ 130), Registration incl ID 19.23 (KES 2,500 @ 130), Graduation 38.46 (KES 5,000 @ 130)
  ('rcl_app', 'rc_access', 'lvl_ug', 'fi_app', 385, NULL, NULL, NULL, '2026-10-06T00:00:00Z'),
  ('rcl_reg', 'rc_access', 'lvl_ug', 'fi_reg', 1923, NULL, NULL, NULL, '2026-10-06T00:00:00Z'),
  ('rcl_grad', 'rc_access', 'lvl_ug', 'fi_grad', 3846, NULL, NULL, NULL, '2026-10-06T00:00:00Z');

-- Aid Fund (zero budget initially until owner allocates)
INSERT OR IGNORE INTO aid_funds (id, code, name, budget_base_minor, period_from, period_to, is_active, created_at)
VALUES ('fund_inst_aid', 'INSTITUTIONAL-AID-FUND', 'Institutional Financial Aid & Scholarship Fund', 0, '2026-01-01', '2026-12-31', 1, '2026-10-06T00:00:00Z');

-- Aid Programme (Draft)
INSERT OR IGNORE INTO aid_programmes (id, code, name, kind, method, invoice_label, public_criteria_text, stackable, renewable, requires_sap, status, fund_id, created_at)
VALUES (
  'aid_prog_inst',
  'INSTITUTIONAL-AID',
  'BMI University Institutional Need & Service Aid Programme',
  'need_based',
  'price_cap_rate_card',
  'Institutional Award',
  'Awards are determined objectively based on demonstrated household need, dependants, church/ministry service, and available scholarship funds. Open to all applicants.',
  0, 1, 1, 'draft', 'fund_inst_aid', '2026-10-06T00:00:00Z'
);

-- Aid Bands (Bands A through D)
INSERT OR IGNORE INTO aid_bands (id, aid_programme_id, band_label, sort_order, min_need_score, max_need_score, method, percent_bps, rate_card_id, created_at)
VALUES
  ('band_a', 'aid_prog_inst', 'Band A (Access Rate Card)', 1, 80.0, 100.0, 'rate_card', NULL, 'rc_access', '2026-10-06T00:00:00Z'),
  ('band_b', 'aid_prog_inst', 'Band B (75% Tuition Subsidy)', 2, 60.0, 79.99, 'percent', 7500, NULL, '2026-10-06T00:00:00Z'),
  ('band_c', 'aid_prog_inst', 'Band C (50% Tuition Subsidy)', 3, 40.0, 59.99, 'percent', 5000, NULL, '2026-10-06T00:00:00Z'),
  ('band_d', 'aid_prog_inst', 'Band D (25% Tuition Subsidy)', 4, 20.0, 39.99, 'percent', 2500, NULL, '2026-10-06T00:00:00Z');

-- Allowed Criteria Fields (objective, non-discriminatory)
INSERT OR IGNORE INTO aid_criteria_fields (id, code, label, is_allowed, created_at)
VALUES
  ('acf_income', 'household_income', 'Verified Annual Household Income', 1, '2026-10-06T00:00:00Z'),
  ('acf_dependants', 'dependants_count', 'Number of Verified Dependants', 1, '2026-10-06T00:00:00Z'),
  ('acf_ministry', 'ministry_service', 'Documented Church or Community Ministry Service', 1, '2026-10-06T00:00:00Z'),
  ('acf_unemployment', 'employment_status', 'Documented Involuntary Unemployment / Hardship', 1, '2026-10-06T00:00:00Z'),
  ('acf_merit', 'academic_standing', 'Documented Prior Academic Record / GPA', 1, '2026-10-06T00:00:00Z');

-- Ledger Accounts
INSERT OR IGNORE INTO ledger_accounts_v4 (id, account_code, name, type, normal_balance, is_active, created_at)
VALUES
  ('la_1000', '1000', 'Student Accounts Receivable', 'asset', 'debit', 1, '2026-10-06T00:00:00Z'),
  ('la_1010', '1010', 'Payment Gateway Clearing (Paystack)', 'asset', 'debit', 1, '2026-10-06T00:00:00Z'),
  ('la_2000', '2000', 'Customer Account Credits & Unapplied Balances', 'liability', 'credit', 1, '2026-10-06T00:00:00Z'),
  ('la_4000', '4000', 'Tuition Revenue', 'revenue', 'credit', 1, '2026-10-06T00:00:00Z'),
  ('la_4010', '4010', 'Application Fee Revenue', 'revenue', 'credit', 1, '2026-10-06T00:00:00Z'),
  ('la_4020', '4020', 'Registration & Matriculation Fee Revenue', 'revenue', 'credit', 1, '2026-10-06T00:00:00Z'),
  ('la_4030', '4030', 'Graduation Fee Revenue', 'revenue', 'credit', 1, '2026-10-06T00:00:00Z'),
  ('la_4040', '4040', 'Academic Event & Examination Fee Revenue', 'revenue', 'credit', 1, '2026-10-06T00:00:00Z'),
  ('la_4900', '4900', 'Institutional Awards & Fee Subsidies (Contra-Revenue)', 'contra_revenue', 'debit', 1, '2026-10-06T00:00:00Z'),
  ('la_5000', '5000', 'Approved Student Fee Refunds', 'expense', 'debit', 1, '2026-10-06T00:00:00Z'),
  ('la_5010', '5010', 'Bad Debt & Balance Write-Offs', 'expense', 'debit', 1, '2026-10-06T00:00:00Z');

-- Initial Document Sequences
INSERT OR IGNORE INTO document_sequences (name, year, next_value)
VALUES
  ('invoice', 2026, 1),
  ('receipt', 2026, 1),
  ('credit_note', 2026, 1);

-- Finance Settings
INSERT OR IGNORE INTO finance_settings (key, value_json, value_type, description, updated_by, updated_at)
VALUES
  ('finance.fees_v2_enabled', 'false', 'boolean', 'Feature flag enabling BMI Fees System v4 engine', 'system', '2026-10-06T00:00:00Z'),
  ('finance.base_currency', '"USD"', 'string', 'Authoritative institutional base currency', 'system', '2026-10-06T00:00:00Z'),
  ('finance.default_charge_currency', '"KES"', 'string', 'Default currency presented to domestic students', 'system', '2026-10-06T00:00:00Z'),
  ('finance.price_lock_policy', '"enrollment"', 'string', 'Price guarantee policy (enrollment = pinned at admit)', 'system', '2026-10-06T00:00:00Z'),
  ('finance.clearance_mode', '"current_instalment_paid"', 'string', 'Requirement for term course registration clearance', 'system', '2026-10-06T00:00:00Z'),
  ('finance.grace_days', '14', 'number', 'Days after due date before account hold is placed', 'system', '2026-10-06T00:00:00Z'),
  ('finance.reminder_days_before_due', '[7, 3, 1]', 'array', 'Days prior to due date for scheduled reminder notices', 'system', '2026-10-06T00:00:00Z'),
  ('finance.minimum_partial_payment_minor', '1000', 'number', 'Minimum partial payment allowed ($10.00 USD equivalent)', 'system', '2026-10-06T00:00:00Z'),
  ('finance.partial_payments_enabled', 'true', 'boolean', 'Whether students can make partial payments toward an invoice', 'system', '2026-10-06T00:00:00Z'),
  ('finance.late_fees_enabled', 'false', 'boolean', 'Whether automatic late fee penalties are assessed', 'system', '2026-10-06T00:00:00Z'),
  ('finance.pass_through_gateway_fee', 'false', 'boolean', 'Whether payment gateway processing fees are surcharged to payer', 'system', '2026-10-06T00:00:00Z'),
  ('finance.payment_channels', '["card", "mobile_money", "bank_transfer"]', 'array', 'Enabled payment channels', 'system', '2026-10-06T00:00:00Z'),
  ('finance.invoice_number_format', '"INV-{YEAR}-{SEQ:6}"', 'string', 'Official invoice sequence pattern', 'system', '2026-10-06T00:00:00Z'),
  ('finance.receipt_number_format', '"REC-{YEAR}-{SEQ:6}"', 'string', 'Official receipt sequence pattern', 'system', '2026-10-06T00:00:00Z'),
  ('finance.credit_note_format', '"CRN-{YEAR}-{SEQ:6}"', 'string', 'Official credit note pattern', 'system', '2026-10-06T00:00:00Z'),
  ('finance.document_prefix', '"BMI"', 'string', 'Document reference prefix', 'system', '2026-10-06T00:00:00Z'),
  ('finance.pending_payment_sweep_minutes', '30', 'number', 'Interval to poll pending payment intents from gateway', 'system', '2026-10-06T00:00:00Z'),
  ('finance.tax_enabled', 'false', 'boolean', 'Whether VAT/tax is levied on educational fees', 'system', '2026-10-06T00:00:00Z'),
  ('finance.gateway_status', '"pending_approval"', 'string', 'Gateway readiness: pending_approval, test, or live', 'system', '2026-10-06T00:00:00Z'),
  ('finance.pending_gateway_policy', '"defer_collection"', 'string', 'Policy when gateway is under review: defer_collection or block', 'system', '2026-10-06T00:00:00Z'),
  ('finance.deferral_ends_at', '"2026-12-31T23:59:59Z"', 'string', 'Grace deadline for deferred collection cutover', 'system', '2026-10-06T00:00:00Z'),
  ('registration.unpaid_seat_hold_hours', '72', 'number', 'Hours a reserved course seat is held before release', 'system', '2026-10-06T00:00:00Z'),
  ('aid.need_blind_enabled', 'true', 'boolean', 'Guarantees admissions decisions cannot view aid records', 'system', '2026-10-06T00:00:00Z'),
  ('aid.invoice_label', '"Institutional Award"', 'string', 'Neutral description displayed on student invoices', 'system', '2026-10-06T00:00:00Z'),
  ('aid.report_small_cell_threshold', '5', 'number', 'Minimum cohort size for public reporting privacy suppression', 'system', '2026-10-06T00:00:00Z'),
  ('aid.appeal_window_days', '14', 'number', 'Days allowed to appeal an award decision', 'system', '2026-10-06T00:00:00Z'),
  ('aid.max_award_percent_bps', '10000', 'number', 'Hard cap on combined awards (10000 = 100%)', 'system', '2026-10-06T00:00:00Z'),
  ('aid.max_band_step_bps', '2500', 'number', 'Maximum step between adjacent subsidy bands (2500 = 25%)', 'system', '2026-10-06T00:00:00Z'),
  ('aid.reassessment_months', '12', 'number', 'Cadence for periodic financial need recertification', 'system', '2026-10-06T00:00:00Z'),
  ('aid.verification_sample_bps', '1000', 'number', 'Random verification audit sample (1000 = 10%)', 'system', '2026-10-06T00:00:00Z'),
  ('aid.when_budget_exhausted', '"waitlist"', 'string', 'Action when fund budget is depleted: waitlist or block', 'system', '2026-10-06T00:00:00Z');

-- Institution Settings
INSERT OR IGNORE INTO institution_settings (key, value, description, updated_at)
VALUES
  ('academic_brand', 'BMI University', 'Public institutional trading brand', '2026-10-06T00:00:00Z'),
  ('academic_full', 'Bethel Ministries International University', 'Full legal chartered name', '2026-10-06T00:00:00Z'),
  ('legal_name', 'BEMI TRAINING INSTITUTE', 'Registered business entity name matching payment gateway account', '2026-10-06T00:00:00Z'),
  ('postal_address', 'P.O. Box 24264 - 00502, Karen, Nairobi, Kenya', 'Official postal correspondence address', '2026-10-06T00:00:00Z'),
  ('location', 'Karen Campus, Nairobi, Kenya', 'Campus physical location', '2026-10-06T00:00:00Z'),
  ('phone', '+254 700 000 000', 'Official admissions and bursar helpline', '2026-10-06T00:00:00Z'),
  ('admissions_email', 'admissions@bmiuniversities.org', 'Official student admissions office email', '2026-10-06T00:00:00Z'),
  ('receipt_footer', 'Payment received by BEMI TRAINING INSTITUTE (trading as BMI University).', 'Mandatory receipt descriptor note', '2026-10-06T00:00:00Z'),
  ('payment_description_template', 'BEMI TRAINING INSTITUTE - {REASON}', 'Standard Paystack checkout item description', '2026-10-06T00:00:00Z');
