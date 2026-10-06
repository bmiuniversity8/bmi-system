import { pgTable, text, integer, real, timestamp, primaryKey, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─── Auth / Identity ─────────────────────────────────────────────────────────
// NOTE: Boolean-ish flags are stored as INTEGER 0/1 to stay wire-compatible
// with the existing D1 raw-SQL routes (which compare `=== 1`). Strict BOOLEAN
// columns are adopted incrementally as routes migrate to Drizzle (Phase 4).
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  password_hash: text('password_hash').notNull(),
  first_name: text('first_name').notNull(),
  last_name: text('last_name').notNull(),
  phone: text('phone'),
  role: text('role').notNull().default('applicant'),
  is_verified: integer('is_verified').notNull().default(0),
  verification_token: text('verification_token'),
  mfa_secret: text('mfa_secret'),
  mfa_enabled: integer('mfa_enabled').notNull().default(0),
  session_version: integer('session_version').notNull().default(1),
  failed_login_attempts: integer('failed_login_attempts').notNull().default(0),
  locked_until: timestamp('locked_until'),
  account_claimed: integer('account_claimed').notNull().default(0),
  student_email: text('student_email'),
  person_id: text('person_id'),
  admission_code: text('admission_code'),
  admission_code_expires_at: timestamp('admission_code_expires_at'),
  date_of_birth: timestamp('date_of_birth'),
  nationality: text('nationality'),
  address: text('address'),
  gender: text('gender'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('users_email_unique').on(t.email),
  index('idx_users_role').on(t.role),
]);

// ─── Generic Key-Value Metadata ──────────────────────────────────────────────
export const metadata = pgTable('metadata', {
  id: text('id').notNull(),
  key: text('key').notNull(),
  value: text('value').notNull(),
}, (t) => [
  primaryKey({ columns: [t.id, t.key] }),
]);

// ─── Academic Structure ──────────────────────────────────────────────────────
export const faculties = pgTable('faculties', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  dean_id: text('dean_id'),
  description: text('description'),
  is_active: integer('is_active').notNull().default(1),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('faculties_code_unique').on(t.code),
]);

export const departments = pgTable('departments', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  faculty_id: text('faculty_id').notNull(),
  head_id: text('head_id'),
  school_id: text('school_id'),
  description: text('description'),
  is_active: integer('is_active').notNull().default(1),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('departments_code_unique').on(t.code),
  index('idx_departments_faculty').on(t.faculty_id),
  index('idx_departments_school').on(t.school_id),
]);

export const programs = pgTable('programs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  degree_type: text('degree_type').notNull(),
  level: text('level').notNull(),
  department_id: text('department_id').notNull(),
  duration_years: integer('duration_years').notNull(),
  total_credit_hours: integer('total_credit_hours').notNull(),
  mode_of_study: text('mode_of_study').notNull(),
  description: text('description'),
  icon: text('icon'),
  career_code: text('career_code'),
  isced_code: text('isced_code'),
  is_active: integer('is_active').notNull().default(1),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('programs_code_unique').on(t.code),
  index('idx_programs_department').on(t.department_id),
  index('idx_programs_level').on(t.level),
  index('idx_programs_career').on(t.career_code),
  index('idx_programs_isced').on(t.isced_code),
  index('idx_programs_active').on(t.is_active),
]);

export const courses = pgTable('courses', {
  id: text('id').primaryKey(),
  code: text('code').notNull(),
  title: text('title').notNull(),
  name: text('name'),
  description: text('description'),
  level: text('level'),
  credits: integer('credits').notNull(),
  term: text('term'),
  capacity: integer('capacity').notNull(),
  department_id: text('department_id'),
  program_id: text('program_id'),
  is_active: integer('is_active').notNull().default(1),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('courses_code_unique').on(t.code),
  index('idx_courses_department').on(t.department_id),
  index('idx_courses_program').on(t.program_id),
]);

export const academicTerms = pgTable('academic_terms', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  academic_year: text('academic_year').notNull(),
  semester_number: integer('semester_number').notNull(),
  start_date: timestamp('start_date').notNull(),
  end_date: timestamp('end_date').notNull(),
  status: text('status').notNull().default('upcoming'),
  registration_opens_at: timestamp('registration_opens_at'),
  registration_closes_at: timestamp('registration_closes_at'),
  census_date: timestamp('census_date'),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('academic_terms_code_unique').on(t.code),
]);

// ─── Portals / App Config ────────────────────────────────────────────────────
export const appConfig = pgTable('app_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const persons = pgTable('persons', {
  id: text('id').primaryKey(),
  uid: text('uid').notNull(),
  national_id: text('national_id'),
  passport_no: text('passport_no'),
  first_name: text('first_name'),
  middle_name: text('middle_name'),
  last_name: text('last_name'),
  gender: text('gender'),
  date_of_birth: timestamp('date_of_birth'),
  nationality: text('nationality'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('persons_uid_unique').on(t.uid),
]);

// ─── Applications & Admissions ────────────────────────────────────────────────
export const applications = pgTable('applications', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull(),
  program: text('program').notNull(),
  program_id: text('program_id'),
  degree_level: text('degree_level').notNull(),
  status: text('status').notNull().default('draft'),
  personal_statement: text('personal_statement'),
  prior_education: text('prior_education'),
  submitted_at: timestamp('submitted_at'),
  reviewed_at: timestamp('reviewed_at'),
  reviewer_id: text('reviewer_id'),
  reviewer_notes: text('reviewer_notes'),
  application_number: text('application_number'),
  high_school: text('high_school'),
  graduation_year: integer('graduation_year'),
  gpa: real('gpa'),
  possible_duplicate_of: text('possible_duplicate_of'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_apps_user_id').on(t.user_id),
  index('idx_apps_status').on(t.status),
  index('idx_apps_program_id').on(t.program_id),
  // Partial unique index: only enforce uniqueness when application_number is assigned.
  // NULLs (draft applications) are exempt — Postgres would otherwise reject multiple drafts.
  uniqueIndex('idx_applications_number').on(t.application_number).where(sql`${t.application_number} IS NOT NULL`),
]);

export const admissionsDecisions = pgTable('admissions_decisions', {
  id: text('id').primaryKey(),
  application_id: text('application_id').notNull(),
  decision: text('decision').notNull(), // 'admit' | 'conditional' | 'waitlist' | 'deny'
  decided_by: text('decided_by').notNull(),
  decided_at: timestamp('decided_at').notNull().defaultNow(),
  conditions: text('conditions'),
  offer_expires_at: timestamp('offer_expires_at'),
  deposit_required: integer('deposit_required').notNull().default(0),
  deposit_amount: real('deposit_amount').notNull().default(0),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('admissions_decisions_app_id_unique').on(t.application_id),
  index('idx_admissions_decisions_decision').on(t.decision),
]);

export const enrollmentDeposits = pgTable('enrollment_deposits', {
  id: text('id').primaryKey(),
  application_id: text('application_id').notNull(),
  user_id: text('user_id').notNull(),
  amount: real('amount').notNull(),
  paid_at: timestamp('paid_at').notNull().defaultNow(),
  payment_reference: text('payment_reference').notNull(),
  status: text('status').notNull().default('confirmed'),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_enrollment_deposits_app_id').on(t.application_id),
  index('idx_enrollment_deposits_user_id').on(t.user_id),
  uniqueIndex('idx_enrollment_deposits_payment_ref_unique').on(t.payment_reference),
]);

export const enrollmentStatusLogs = pgTable('enrollment_status_logs', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull(),
  person_id: text('person_id'),
  status: text('status').notNull(),
  term_id: text('term_id'),
  changed_by: text('changed_by').notNull(),
  reason: text('reason'),
  changed_at: timestamp('changed_at').notNull().defaultNow(),
}, (t) => [
  index('idx_enrollment_status_user').on(t.user_id),
  index('idx_enrollment_status_current').on(t.user_id, t.status),
]);

export const esignatures = pgTable('esignatures', {
  id: text('id').primaryKey(),
  document_id: text('document_id').notNull(),
  user_id: text('user_id').notNull(),
  person_id: text('person_id'),
  signed_name: text('signed_name').notNull(),
  signed_at: timestamp('signed_at').notNull().defaultNow(),
  ip_address: text('ip_address'),
  user_agent: text('user_agent'),
  document_version_hash: text('document_version_hash').notNull(),
  term_id: text('term_id'),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_esignatures_user_id').on(t.user_id),
  index('idx_esignatures_doc_id').on(t.document_id),
  index('idx_esignatures_term').on(t.term_id),
]);

export const financialAidAwards = pgTable('financial_aid_awards', {
  id: text('id').primaryKey(),
  student_id: text('student_id').notNull(),
  aid_type: text('aid_type').notNull(),
  amount: real('amount').notNull(),
  status: text('status').notNull().default('awarded'),
  term_id: text('term_id'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_financial_aid_student').on(t.student_id),
  index('idx_financial_aid_term').on(t.term_id),
]);

export const applicationDrafts = pgTable('application_drafts', {
  user_id: text('user_id').primaryKey(),
  application_data: text('application_data').notNull(),
  current_step: integer('current_step').notNull().default(1),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
  created_at: timestamp('created_at').notNull().defaultNow(),
});

export const applicationStatusLogs = pgTable('application_status_logs', {
  id: text('id').primaryKey(),
  application_id: text('application_id').notNull(),
  changed_by: text('changed_by').notNull(),
  old_status: text('old_status'),
  new_status: text('new_status').notNull(),
  notes: text('notes'),
  changed_at: timestamp('changed_at').notNull().defaultNow(),
}, (t) => [
  index('idx_status_logs_app_id').on(t.application_id),
]);

export const applicationNumberCounters = pgTable('application_number_counters', {
  year: integer('year').primaryKey(),
  last_serial: integer('last_serial').notNull().default(0),
});

// ─── Documents ────────────────────────────────────────────────────────────────
export const documents = pgTable('documents', {
  id: text('id').primaryKey(),
  application_id: text('application_id').notNull(),
  user_id: text('user_id').notNull(),
  doc_type: text('doc_type').notNull(),
  file_name: text('file_name').notNull(),
  r2_key: text('r2_key').notNull(),
  mime_type: text('mime_type').notNull(),
  file_size_bytes: integer('file_size_bytes').notNull().default(0),
  verification_status: text('verification_status').notNull().default('self_reported'),
  verified_by: text('verified_by'),
  verified_at: timestamp('verified_at'),
  source: text('source').default('upload'),
  uploaded_at: timestamp('uploaded_at').notNull().defaultNow(),
  archived_at: timestamp('archived_at'),
  expires_at: timestamp('expires_at'),
  is_sensitive: integer('is_sensitive').notNull().default(0),
  view_count: integer('view_count').notNull().default(0),
}, (t) => [
  uniqueIndex('documents_r2_key_unique').on(t.r2_key),
  index('idx_docs_application_id').on(t.application_id),
  index('idx_docs_user_id').on(t.user_id),
  index('idx_docs_archived').on(t.archived_at),
  index('idx_docs_expires').on(t.expires_at),
]);

export const recommendationRequests = pgTable('recommendation_requests', {
  id: text('id').primaryKey(),
  application_id: text('application_id').notNull(),
  referee_name: text('referee_name').notNull(),
  referee_email: text('referee_email').notNull(),
  token: text('token').notNull(),
  status: text('status').notNull().default('requested'),
  document_id: text('document_id'),
  requested_at: timestamp('requested_at').notNull().defaultNow(),
  completed_at: timestamp('completed_at'),
}, (t) => [
  uniqueIndex('recommendation_requests_token_unique').on(t.token),
  index('idx_recs_app_id').on(t.application_id),
]);

// ─── Auth / Sessions / Verification ───────────────────────────────────────────
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull(),
  expires_at: timestamp('expires_at').notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_sessions_user_id').on(t.user_id),
  index('idx_sessions_expires').on(t.expires_at),
]);

export const rateLimits = pgTable('rate_limits', {
  ip_address: text('ip_address').notNull(),
  endpoint: text('endpoint').notNull(),
  window_start: timestamp('window_start').notNull().defaultNow(),
  request_count: integer('request_count').notNull().default(1),
}, (t) => [
  primaryKey({ columns: [t.ip_address, t.endpoint, t.window_start] }),
  index('idx_rate_limits_ip').on(t.ip_address, t.window_start),
]);

export const emailVerifications = pgTable('email_verifications', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull(),
  token: text('token').notNull(),
  expires_at: timestamp('expires_at').notNull(),
  verified_at: timestamp('verified_at'),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('email_verifications_token_unique').on(t.token),
  index('idx_email_verif_user').on(t.user_id),
]);

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull(),
  token: text('token').notNull(),
  expires_at: timestamp('expires_at').notNull(),
  used_at: timestamp('used_at'),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('password_reset_tokens_token_unique').on(t.token),
  index('idx_pwd_reset_user').on(t.user_id),
]);

export const oauthAccounts = pgTable('oauth_accounts', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull(),
  provider: text('provider').notNull(),
  provider_id: text('provider_id').notNull(),
  access_token: text('access_token').notNull(),
  refresh_token: text('refresh_token'),
  expires_at: timestamp('expires_at'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('oauth_accounts_provider_provider_id_unique').on(t.provider, t.provider_id),
  index('idx_oauth_user').on(t.user_id),
]);

export const emailLogs = pgTable('email_logs', {
  id: text('id').primaryKey(),
  to_address: text('to_address').notNull(),
  subject: text('subject').notNull(),
  status: text('status').notNull().default('pending'),
  error_message: text('error_message'),
  attempts: integer('attempts').notNull().default(0),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_email_logs_status').on(t.status),
  index('idx_email_logs_to').on(t.to_address),
]);

// ─── Audit / Logs / Webhooks ──────────────────────────────────────────────────
export const adminAuditLogs = pgTable('admin_audit_logs', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull(),
  action: text('action').notNull(),
  target_type: text('target_type'),
  target_id: text('target_id'),
  details: text('details'),
  ip_address: text('ip_address'),
  user_agent: text('user_agent'),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_admin_audit_user').on(t.user_id),
  index('idx_admin_audit_action').on(t.action),
  index('idx_admin_audit_created').on(t.created_at),
]);

export const syncEventLog = pgTable('sync_event_log', {
  id: text('id').primaryKey(),
  event_type: text('event_type').notNull(),
  payload: text('payload').notNull(),
  target_url: text('target_url'),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  last_error: text('last_error'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  resolved_at: timestamp('resolved_at'),
}, (t) => [
  index('idx_event_log_status').on(t.status),
  index('idx_event_log_type').on(t.event_type),
  index('idx_event_log_created').on(t.created_at),
]);

export const webhookDeadLetters = pgTable('webhook_dead_letters', {
  id: text('id').primaryKey(),
  event_log_id: text('event_log_id').notNull(),
  payload: text('payload').notNull(),
  last_error: text('last_error'),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_dead_letters_event').on(t.event_log_id),
]);

// ─── Finance: Centralized Currencies, FX, Fees & Invoicing ───────────────────
export const currencies = pgTable('currencies', {
  code: text('code').primaryKey(), // 'USD', 'KES'
  name: text('name').notNull(),
  symbol: text('symbol').notNull(),
  minor_unit: integer('minor_unit').notNull().default(2),
  is_base: integer('is_base').notNull().default(0), // 1 for USD
  is_active: integer('is_active').notNull().default(1),
  created_at: timestamp('created_at').notNull().defaultNow(),
});

export const exchangeRates = pgTable('exchange_rates', {
  id: text('id').primaryKey(),
  base_currency: text('base_currency').notNull().default('USD'),
  quote_currency: text('quote_currency').notNull().default('KES'),
  rate: real('rate').notNull(),
  rate_type: text('rate_type').notNull().default('MEAN'), // 'MEAN', 'BID', 'ASK', 'MANUAL'
  source: text('source').notNull().default('CBK'), // 'CBK', 'MANUAL'
  source_reference: text('source_reference'),
  status: text('status').notNull().default('active'), // 'active', 'stale', 'superseded', 'expired'
  published_at: timestamp('published_at'),
  effective_at: timestamp('effective_at').notNull().defaultNow(),
  retrieved_at: timestamp('retrieved_at').notNull().defaultNow(),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_exchange_rates_pair').on(t.base_currency, t.quote_currency),
  index('idx_exchange_rates_status').on(t.status),
  index('idx_exchange_rates_effective').on(t.effective_at),
]);

export const feeSchedules = pgTable('fee_schedules', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  version: text('version').notNull().default('2026.1'),
  academic_year: text('academic_year').notNull().default('2026-2027'),
  base_currency: text('base_currency').notNull().default('USD'),
  status: text('status').notNull().default('active'), // 'active', 'draft', 'archived'
  effective_from: timestamp('effective_from'),
  effective_to: timestamp('effective_to'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

export const feeGroups = pgTable('fee_groups', {
  id: text('id').primaryKey(),
  code: text('code').notNull(), // 'TUITION', 'STUDENT_ONBOARDING', 'STATUTORY'
  name: text('name').notNull(),
  description: text('description'),
  display_order: integer('display_order').notNull().default(0),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('fee_groups_code_unique').on(t.code),
]);

export const feeItems = pgTable('fee_items', {
  id: text('id').primaryKey(),
  fee_schedule_id: text('fee_schedule_id').notNull(),
  fee_group_id: text('fee_group_id').notNull(),
  code: text('code').notNull(), // 'APPLICATION_FEE', 'REGISTRATION_FEE', 'STUDENT_ID_FEE', etc.
  name: text('name').notNull(),
  degree_level: text('degree_level'), // 'certificate', 'diploma', 'undergraduate', 'graduate', 'doctorate'
  amount_base_minor: integer('amount_base_minor').notNull(),
  amount_base: real('amount_base').notNull(),
  base_currency: text('base_currency').notNull().default('USD'),
  billing_frequency: text('billing_frequency').notNull().default('once'),
  billing_periods: integer('billing_periods').notNull().default(1),
  allocation_strategy: text('allocation_strategy').notNull().default('DESCENDING_WHOLE_UNIT'),
  trigger_event: text('trigger_event'),
  is_optional: integer('is_optional').notNull().default(0),
  is_configured: integer('is_configured').notNull().default(1),
  is_billable: integer('is_billable').notNull().default(1),
  is_active: integer('is_active').notNull().default(1),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_fee_items_schedule').on(t.fee_schedule_id),
  index('idx_fee_items_group').on(t.fee_group_id),
  index('idx_fee_items_level').on(t.degree_level),
  index('idx_fee_items_code').on(t.code),
]);

export const feeScheduleInstallments = pgTable('fee_schedule_installments', {
  id: text('id').primaryKey(),
  fee_schedule_id: text('fee_schedule_id').notNull(),
  fee_item_id: text('fee_item_id').notNull(),
  degree_level: text('degree_level').notNull(),
  period_number: integer('period_number').notNull(),
  amount_base_minor: integer('amount_base_minor').notNull(),
  amount_base: real('amount_base').notNull(),
  currency: text('currency').notNull().default('USD'),
  allocation_strategy: text('allocation_strategy').notNull().default('DESCENDING_WHOLE_UNIT'),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('idx_fee_installments_unique').on(t.fee_item_id, t.period_number),
  index('idx_fee_installments_level').on(t.degree_level),
]);

export const invoices = pgTable('invoices', {
  id: text('id').primaryKey(),
  invoice_number: text('invoice_number'),
  student_id: text('student_id').notNull(),
  uid: text('uid'),
  programme_id: text('programme_id'),
  degree_level: text('degree_level'),
  fee_schedule_id: text('fee_schedule_id'),
  academic_year: text('academic_year'),
  term_id: text('term_id'),
  period_number: integer('period_number'),

  // FX Snapshot
  base_currency: text('base_currency').notNull().default('USD'),
  billing_currency: text('billing_currency').notNull().default('KES'),
  exchange_rate: real('exchange_rate'),
  exchange_rate_id: text('exchange_rate_id'),
  exchange_rate_source: text('exchange_rate_source').default('CBK'),
  exchange_rate_effective_at: timestamp('exchange_rate_effective_at'),

  // Financial Totals
  subtotal_base: real('subtotal_base'),
  subtotal_billing: real('subtotal_billing'),
  discount: real('discount').notNull().default(0),
  adjustment: real('adjustment').notNull().default(0),
  total_base: real('total_base'),
  total_billing: real('total_billing'),
  amount: real('amount').notNull(), // Preserved for backward compatibility (= total_billing)
  paid_amount: real('paid_amount').notNull().default(0),
  balance: real('balance'),

  status: text('status').notNull().default('unpaid'),
  issue_date: timestamp('issue_date'),
  due_date: timestamp('due_date').notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_invoices_student').on(t.student_id),
  index('idx_invoices_uid').on(t.uid),
  index('idx_invoices_term').on(t.term_id),
  index('idx_invoices_status').on(t.status),
  uniqueIndex('idx_invoices_number_unique').on(t.invoice_number),
]);

export const invoiceLines = pgTable('invoice_lines', {
  id: text('id').primaryKey(),
  invoice_id: text('invoice_id').notNull(),
  fee_item_id: text('fee_item_id'),
  fee_group_id: text('fee_group_id'),
  description: text('description').notNull(),
  quantity: integer('quantity').notNull().default(1),
  unit_amount_base: real('unit_amount_base').notNull(),
  base_currency: text('base_currency').notNull().default('USD'),
  unit_amount_billing: real('unit_amount_billing').notNull(),
  billing_currency: text('billing_currency').notNull().default('KES'),
  exchange_rate: real('exchange_rate').notNull(),
  period_number: integer('period_number'),
  term_id: text('term_id'),
  line_total_base: real('line_total_base').notNull(),
  line_total_billing: real('line_total_billing').notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_invoice_lines_invoice').on(t.invoice_id),
]);

export const payments = pgTable('payments', {
  id: text('id').primaryKey(),
  payment_reference: text('payment_reference').notNull(),
  student_id: text('student_id').notNull(),
  uid: text('uid'),
  provider: text('provider').notNull().default('paystack'),
  channel: text('channel'),
  amount: real('amount').notNull(),
  currency: text('currency').notNull(),
  amount_base_equivalent: real('amount_base_equivalent'),
  exchange_rate: real('exchange_rate'),
  exchange_rate_source: text('exchange_rate_source'),
  status: text('status').notNull().default('pending'),
  provider_status: text('provider_status'),
  raw_response: text('raw_response'),
  paid_at: timestamp('paid_at'),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('idx_payments_reference_unique').on(t.payment_reference),
  index('idx_payments_student').on(t.student_id),
  index('idx_payments_status').on(t.status),
]);

export const paymentAllocations = pgTable('payment_allocations', {
  id: text('id').primaryKey(),
  payment_id: text('payment_id').notNull(),
  invoice_id: text('invoice_id').notNull(),
  invoice_line_id: text('invoice_line_id'),
  allocated_amount: real('allocated_amount').notNull(),
  currency: text('currency').notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_allocations_payment').on(t.payment_id),
  index('idx_allocations_invoice').on(t.invoice_id),
]);

export const financialAuditLog = pgTable('financial_audit_log', {
  id: text('id').primaryKey(),
  action: text('action').notNull(),
  actor_id: text('actor_id'),
  target_type: text('target_type').notNull(),
  target_id: text('target_id').notNull(),
  old_value: text('old_value'),
  new_value: text('new_value'),
  reason: text('reason'),
  source: text('source'),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_fin_audit_action').on(t.action),
  index('idx_fin_audit_target').on(t.target_type, t.target_id),
]);

export const financialAdjustments = pgTable('financial_adjustments', {
  id: text('id').primaryKey(),
  student_id: text('student_id').notNull(),
  invoice_id: text('invoice_id'),
  adjustment_type: text('adjustment_type').notNull(),
  amount: real('amount').notNull(),
  currency: text('currency').notNull().default('USD'),
  reason: text('reason').notNull(),
  approved_by: text('approved_by').notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_fin_adj_student').on(t.student_id),
  index('idx_fin_adj_invoice').on(t.invoice_id),
]);

export const ledgerAccounts = pgTable('ledger_accounts', {
  id: text('id').primaryKey(),
  uid: text('uid').notNull(),
  status: text('status').notNull().default('active'),
  label: text('label'),
  metadata: text('metadata'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('ledger_accounts_uid_unique').on(t.uid),
  index('idx_ledger_accounts_uid').on(t.uid),
]);

export const ledgerEntries = pgTable('ledger_entries', {
  id: text('id').primaryKey(),
  account_id: text('account_id').notNull(),
  entry_type: text('entry_type').notNull(),
  amount: real('amount').notNull(),
  currency: text('currency').notNull(), // Explicit currency required (KES or USD), no default XAF
  description: text('description'),
  reference_type: text('reference_type'),
  reference_id: text('reference_id'),
  term_id: text('term_id'),
  created_by: text('created_by'),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_ledger_entries_account').on(t.account_id),
  index('idx_ledger_entries_term').on(t.term_id),
  index('idx_ledger_entries_type').on(t.entry_type),
]);

// ─── CMS ──────────────────────────────────────────────────────────────────────
export const cmsPages = pgTable('cms_pages', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  content: text('content'),
  status: text('status').notNull().default('draft'),
  author_id: text('author_id').notNull(),
  published_at: timestamp('published_at'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('cms_pages_slug_unique').on(t.slug),
  index('idx_cms_pages_status').on(t.status),
]);

export const cmsPosts = pgTable('cms_posts', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  excerpt: text('excerpt'),
  content: text('content'),
  status: text('status').notNull().default('draft'),
  author_id: text('author_id').notNull(),
  published_at: timestamp('published_at'),
  tags: text('tags'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('cms_posts_slug_unique').on(t.slug),
  index('idx_cms_posts_status').on(t.status),
  index('idx_cms_posts_published_at').on(t.published_at),
]);

export const cmsMedia = pgTable('cms_media', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  r2_key: text('r2_key').notNull(),
  mime_type: text('mime_type').notNull(),
  file_size_bytes: integer('file_size_bytes').notNull(),
  uploader_id: text('uploader_id').notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('cms_media_r2_key_unique').on(t.r2_key),
  index('idx_cms_media_uploader').on(t.uploader_id),
]);

export const contactSubmissions = pgTable('contact_submissions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  subject: text('subject').notNull(),
  message: text('message').notNull(),
  ip_address: text('ip_address'),
  user_agent: text('user_agent'),
  status: text('status').notNull().default('new'),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_contact_status').on(t.status),
  index('idx_contact_created').on(t.created_at),
  index('idx_contact_email').on(t.email),
]);

export const newsletterSubscribers = pgTable('newsletter_subscribers', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  source: text('source').notNull().default('website_footer'),
  status: text('status').notNull().default('active'),
  subscribed_at: timestamp('subscribed_at').notNull().defaultNow(),
  unsubscribed_at: timestamp('unsubscribed_at'),
}, (t) => [
  uniqueIndex('newsletter_subscribers_email_unique').on(t.email),
  index('idx_newsletter_status').on(t.status),
]);

// ─── Student Support & Settings ───────────────────────────────────────────────
export const studentSettings = pgTable('student_settings', {
  student_id: text('student_id').primaryKey(),
  directory_release: integer('directory_release').notNull().default(1),
  communications_opt_in: integer('communications_opt_in').notNull().default(1),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

export const supportTickets = pgTable('support_tickets', {
  id: text('id').primaryKey(),
  student_id: text('student_id').notNull(),
  subject: text('subject').notNull(),
  description: text('description').notNull(),
  status: text('status').notNull().default('open'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_support_tickets_student').on(t.student_id),
]);

// ─── Identity Counters & Lifecycle ────────────────────────────────────────────
export const uidCounters = pgTable('uid_counters', {
  id: integer('id').primaryKey(),
  last_serial: integer('last_serial').notNull().default(0),
});

export const regnoCounters = pgTable('regno_counters', {
  program_id: text('program_id').notNull(),
  admission_year: integer('admission_year').notNull(),
  last_serial: integer('last_serial').notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.program_id, t.admission_year] }),
]);

export const studentPrograms = pgTable('student_programs', {
  id: text('id').primaryKey(),
  uid: text('uid').notNull(),
  registration_number: text('registration_number'),
  program_id: text('program_id').notNull(),
  admission_year: integer('admission_year').notNull(),
  enrollment_date: timestamp('enrollment_date').notNull(),
  completion_date: timestamp('completion_date'),
  status: text('status').notNull().default('active'),
  current_flag: integer('current_flag').notNull().default(1),
  graduated_flag: integer('graduated_flag').notNull().default(0),
  cgpa: real('cgpa'),
  classification: text('classification'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_student_progs_uid').on(t.uid),
  index('idx_student_progs_program').on(t.program_id),
  index('idx_student_progs_current').on(t.uid, t.current_flag),
  uniqueIndex('idx_student_progs_one_current').on(t.uid),
]);

export const lifecycleEvents = pgTable('lifecycle_events', {
  id: text('id').primaryKey(),
  uid: text('uid'),
  application_id: text('application_id'),
  stage: text('stage').notNull(),
  status: text('status').notNull().default('pending'),
  idempotency_key: text('idempotency_key').notNull(),
  actor_id: text('actor_id'),
  notes: text('notes'),
  error_detail: text('error_detail'),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('lifecycle_events_idempotency_key_unique').on(t.idempotency_key),
  index('idx_lifecycle_uid').on(t.uid),
  index('idx_lifecycle_app_id').on(t.application_id),
  index('idx_lifecycle_stage').on(t.stage, t.status),
  index('idx_lifecycle_created').on(t.created_at),
]);

export const provisioningJobs = pgTable('provisioning_jobs', {
  id: text('id').primaryKey(),
  uid: text('uid').notNull(),
  job_type: text('job_type').notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  last_error: text('last_error'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  completed_at: timestamp('completed_at'),
}, (t) => [
  index('idx_provisioning_uid').on(t.uid),
  index('idx_provisioning_status').on(t.status),
]);

// ─── Academic Structure Support (careers, schools, ISCED, etc.) ───────────────
export const academicCareers = pgTable('academic_careers', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  sort_order: integer('sort_order').notNull().default(0),
  is_active: integer('is_active').notNull().default(1),
  created_at: timestamp('created_at').notNull().defaultNow(),
});

export const schools = pgTable('schools', {
  id: text('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  faculty_id: text('faculty_id').notNull(),
  dean_id: text('dean_id'),
  description: text('description'),
  is_active: integer('is_active').notNull().default(1),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('schools_code_unique').on(t.code),
]);

export const notificationTemplates = pgTable('notification_templates', {
  id: text('id').primaryKey(),
  template_key: text('template_key').notNull(),
  subject: text('subject').notNull(),
  body_html: text('body_html').notNull(),
  body_text: text('body_text'),
  variables: text('variables').notNull().default('[]'),
  is_active: integer('is_active').notNull().default(1),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('notification_templates_template_key_unique').on(t.template_key),
]);

export const codeGenerationLogs = pgTable('code_generation_logs', {
  id: text('id').primaryKey(),
  code_type: text('code_type').notNull(),
  generated_code: text('generated_code').notNull(),
  context: text('context'),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_code_gen_type').on(t.code_type),
  index('idx_code_gen_created').on(t.created_at),
]);

export const iscedFields = pgTable('isced_fields', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  is_active: integer('is_active').notNull().default(1),
  created_at: timestamp('created_at').notNull().defaultNow(),
});

export const transferCredits = pgTable('transfer_credits', {
  id: text('id').primaryKey(),
  student_id: text('student_id').notNull(),
  source_type: text('source_type').notNull(),
  source_name: text('source_name').notNull(),
  source_course_code: text('source_course_code'),
  source_course_title: text('source_course_title'),
  source_credits: real('source_credits').notNull(),
  awarded_credits: real('awarded_credits').notNull().default(0),
  equivalent_course_id: text('equivalent_course_id'),
  recipient_program_id: text('recipient_program_id'),
  term_id: text('term_id'),
  decision: text('decision').notNull().default('pending'),
  reviewed_by: text('reviewed_by'),
  review_notes: text('review_notes'),
  metadata: text('metadata'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_transfer_credits_student').on(t.student_id),
  index('idx_transfer_credits_decision').on(t.decision),
  index('idx_transfer_credits_program').on(t.recipient_program_id),
]);

export const advancedStanding = pgTable('advanced_standing', {
  id: text('id').primaryKey(),
  student_id: text('student_id').notNull(),
  program_id: text('program_id').notNull(),
  course_id: text('course_id').notNull(),
  standing_type: text('standing_type').notNull(),
  approved_by: text('approved_by'),
  approved_at: timestamp('approved_at').notNull().defaultNow(),
  notes: text('notes'),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_advanced_standing_student').on(t.student_id),
  index('idx_advanced_standing_program').on(t.program_id),
]);

// ─── Certificates & Transcripts ───────────────────────────────────────────────
export const certificates = pgTable('certificates', {
  id: text('id').primaryKey(),
  student_id: text('student_id').notNull(),
  serial_number: text('serial_number').notNull(),
  degree_title: text('degree_title').notNull(),
  issue_date: timestamp('issue_date').notNull(),
  gpa: real('gpa'),
  status: text('status').notNull().default('ISSUED'),
  content_hash: text('content_hash').notNull(),
  verification_count: integer('verification_count').notNull().default(0),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('certificates_serial_number_unique').on(t.serial_number),
  index('idx_certificates_student').on(t.student_id),
]);

export const transcriptJobs = pgTable('transcript_jobs', {
  id: text('id').primaryKey(),
  student_id: text('student_id').notNull(),
  status: text('status').notNull().default('queued'),
  format: text('format').notNull().default('pdf'),
  r2_key: text('r2_key'),
  error: text('error'),
  requested_at: timestamp('requested_at').notNull().defaultNow(),
  started_at: timestamp('started_at'),
  completed_at: timestamp('completed_at'),
}, (t) => [
  index('idx_transcript_jobs_student_id').on(t.student_id),
]);

// ─── Fees System v4 ─────────────────────────────────────────────────────────

export const currenciesV4 = pgTable('currencies_v4', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  symbol: text('symbol').notNull(),
  minor_unit_exponent: integer('minor_unit_exponent').notNull().default(2),
  fx_rounding_increment_minor: integer('fx_rounding_increment_minor').notNull().default(1),
  instalment_rounding_minor: integer('instalment_rounding_minor').notNull().default(1),
  gateway_enabled: integer('gateway_enabled').notNull().default(0),
  is_base: integer('is_base').notNull().default(0),
  is_active: integer('is_active').notNull().default(1),
  created_at: timestamp('created_at').notNull().defaultNow(),
});

export const fxRatesV4 = pgTable('fx_rates_v4', {
  id: text('id').primaryKey(),
  base_currency: text('base_currency').notNull(),
  quote_currency: text('quote_currency').notNull(),
  rate_micros: integer('rate_micros').notNull(),
  effective_from: timestamp('effective_from'),
  effective_to: timestamp('effective_to'),
  status: text('status').notNull().default('draft'),
  source: text('source').notNull().default('CBK'),
  set_by: text('set_by'),
  approved_by: text('approved_by'),
  approved_at: timestamp('approved_at'),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_fx_rates_v4_pair').on(t.base_currency, t.quote_currency),
  index('idx_fx_rates_v4_status').on(t.status),
]);

export const feeLevels = pgTable('fee_levels', {
  id: text('id').primaryKey(),
  level_key: text('level_key').notNull(),
  label: text('label').notNull(),
  public_label: text('public_label').notNull(),
  is_billable: integer('is_billable').notNull().default(1),
  sort_order: integer('sort_order').notNull().default(0),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('idx_fee_levels_key_unique').on(t.level_key),
]);

export const feeItemsV4 = pgTable('fee_items_v4', {
  id: text('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  charge_event: text('charge_event').notNull(),
  charge_scope: text('charge_scope').notNull(),
  applies_to_levels: text('applies_to_levels').notNull().default('[]'),
  is_optional: integer('is_optional').notNull().default(0),
  is_refundable: integer('is_refundable'),
  is_active: integer('is_active').notNull().default(1),
  published: integer('published').notNull().default(1),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('idx_fee_items_v4_code_unique').on(t.code),
]);

export const feePlansV4 = pgTable('fee_plans_v4', {
  id: text('id').primaryKey(),
  fee_level_id: text('fee_level_id').notNull(),
  code: text('code').notNull(),
  version: text('version').notNull().default('v1'),
  status: text('status').notNull().default('draft'),
  effective_from: timestamp('effective_from'),
  effective_to: timestamp('effective_to'),
  duration_months: integer('duration_months'),
  instalment_cadence: text('instalment_cadence'),
  instalment_count: integer('instalment_count'),
  created_by: text('created_by'),
  approved_by: text('approved_by'),
  approved_at: timestamp('approved_at'),
  created_at: timestamp('created_at').notNull().defaultNow(),
});

export const feePlanLinesV4 = pgTable('fee_plan_lines_v4', {
  id: text('id').primaryKey(),
  fee_plan_id: text('fee_plan_id').notNull(),
  fee_item_id: text('fee_item_id').notNull(),
  charge_basis: text('charge_basis').notNull(),
  amount_minor: integer('amount_minor').notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
});

export const feeTiersV4 = pgTable('fee_tiers_v4', {
  id: text('id').primaryKey(),
  fee_plan_line_id: text('fee_plan_line_id').notNull(),
  label: text('label').notNull(),
  min_credits: real('min_credits').notNull(),
  max_credits: real('max_credits'),
  amount_minor: integer('amount_minor').notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
});

export const paymentPlanOptionsV4 = pgTable('payment_plan_options_v4', {
  id: text('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  schedule_json: text('schedule_json').notNull(),
  is_active: integer('is_active').notNull().default(1),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('idx_payment_plan_options_v4_code').on(t.code),
]);

export const feePins = pgTable('fee_pins', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull(),
  application_id: text('application_id'),
  fee_plan_id: text('fee_plan_id').notNull(),
  fee_plan_version: text('fee_plan_version').notNull(),
  fx_rate_id: text('fx_rate_id'),
  pinned_at: timestamp('pinned_at').notNull().defaultNow(),
}, (t) => [
  index('idx_fee_pins_user').on(t.user_id),
  index('idx_fee_pins_app').on(t.application_id),
]);

export const financeSettings = pgTable('finance_settings', {
  key: text('key').primaryKey(),
  value_json: text('value_json').notNull(),
  value_type: text('value_type').notNull(),
  description: text('description'),
  updated_by: text('updated_by'),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

export const institutionSettings = pgTable('institution_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  description: text('description'),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

export const refundRules = pgTable('refund_rules', {
  id: text('id').primaryKey(),
  fee_item_id: text('fee_item_id'),
  category: text('category'),
  days_from_start_min: integer('days_from_start_min'),
  days_from_start_max: integer('days_from_start_max'),
  percent: integer('percent').notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
});

export const invoicesV4 = pgTable('invoices_v4', {
  id: text('id').primaryKey(),
  invoice_number: text('invoice_number').notNull(),
  idempotency_key: text('idempotency_key').notNull(),
  kind: text('kind').notNull(),
  source_event: text('source_event').notNull(),
  legacy: integer('legacy').notNull().default(0),
  user_id: text('user_id').notNull(),
  student_id: text('student_id'),
  uid: text('uid'),
  application_id: text('application_id'),
  enrollment_key: text('enrollment_key'),
  term_id: text('term_id'),
  academic_year: text('academic_year'),
  fee_level_id: text('fee_level_id'),
  fee_plan_id: text('fee_plan_id'),
  fee_plan_version: text('fee_plan_version'),
  instalment_no: integer('instalment_no'),
  instalment_of: integer('instalment_of'),
  plan_group_id: text('plan_group_id'),

  base_currency: text('base_currency').notNull(),
  base_subtotal_minor: integer('base_subtotal_minor').notNull(),
  base_discount_minor: integer('base_discount_minor').notNull().default(0),
  base_tax_minor: integer('base_tax_minor').notNull().default(0),
  base_total_minor: integer('base_total_minor').notNull(),
  base_paid_minor: integer('base_paid_minor').notNull().default(0),

  charge_currency: text('charge_currency').notNull(),
  subtotal_minor: integer('subtotal_minor').notNull(),
  discount_minor: integer('discount_minor').notNull().default(0),
  tax_minor: integer('tax_minor').notNull().default(0),
  total_minor: integer('total_minor').notNull(),
  paid_minor: integer('paid_minor').notNull().default(0),
  balance_minor: integer('balance_minor').notNull(),

  fx_rate_id: text('fx_rate_id'),
  fx_rate_micros: integer('fx_rate_micros').notNull(),
  fx_rounding_increment_minor: integer('fx_rounding_increment_minor').notNull().default(1),
  tax_rate_bps: integer('tax_rate_bps'),

  status: text('status').notNull().default('issued'),
  due_date: timestamp('due_date').notNull(),
  issued_at: timestamp('issued_at').notNull().defaultNow(),
  paid_at: timestamp('paid_at'),
  voided_at: timestamp('voided_at'),
  void_reason: text('void_reason'),

  billing_name: text('billing_name'),
  billing_email: text('billing_email'),
  billing_address: text('billing_address'),
  student_number: text('student_number'),
  programme_name: text('programme_name'),
  level_key: text('level_key'),
  level_label: text('level_label'),
  notes: text('notes'),

  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('idx_invoices_v4_number_unique').on(t.invoice_number),
  uniqueIndex('idx_invoices_v4_idempotency_unique').on(t.idempotency_key),
  index('idx_invoices_v4_user').on(t.user_id),
  index('idx_invoices_v4_term').on(t.term_id),
  index('idx_invoices_v4_status').on(t.status),
  index('idx_invoices_v4_enrollment').on(t.enrollment_key),
]);

export const invoiceLinesV4 = pgTable('invoice_lines_v4', {
  id: text('id').primaryKey(),
  invoice_id: text('invoice_id').notNull(),
  line_no: integer('line_no').notNull(),
  fee_item_id: text('fee_item_id').notNull(),
  kind: text('kind').notNull(),
  description: text('description').notNull(),
  quantity: real('quantity').notNull().default(1),
  course_id: text('course_id'),
  base_unit_minor: integer('base_unit_minor').notNull(),
  base_amount_minor: integer('base_amount_minor').notNull(),
  unit_minor: integer('unit_minor').notNull(),
  amount_minor: integer('amount_minor').notNull(),
  award_id: text('award_id'),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_invoice_lines_v4_invoice').on(t.invoice_id),
]);

export const feeCharges = pgTable('fee_charges', {
  id: text('id').primaryKey(),
  charge_key: text('charge_key').notNull(),
  fee_item_id: text('fee_item_id').notNull(),
  invoice_id: text('invoice_id').notNull(),
  status: text('status').notNull().default('billed'),
  created_at: timestamp('created_at').notNull().defaultNow(),
});

export const paymentsV4 = pgTable('payments_v4', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull(),
  gateway: text('gateway').notNull().default('paystack'),
  gateway_reference: text('gateway_reference').notNull(),
  gateway_event_id: text('gateway_event_id'),
  charge_currency: text('charge_currency').notNull(),
  amount_minor: integer('amount_minor').notNull(),
  channel: text('channel'),
  gateway_fee_minor: integer('gateway_fee_minor'),
  status: text('status').notNull().default('pending'),
  paid_at: timestamp('paid_at'),
  raw_payload_hash: text('raw_payload_hash'),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('idx_payments_v4_ref_unique').on(t.gateway_reference),
  index('idx_payments_v4_user').on(t.user_id),
  index('idx_payments_v4_status').on(t.status),
]);

export const paymentAllocationsV4 = pgTable('payment_allocations_v4', {
  id: text('id').primaryKey(),
  payment_id: text('payment_id').notNull(),
  invoice_id: text('invoice_id').notNull(),
  amount_minor: integer('amount_minor').notNull(),
  base_amount_minor: integer('base_amount_minor').notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_payment_alloc_v4_pay').on(t.payment_id),
  index('idx_payment_alloc_v4_inv').on(t.invoice_id),
]);

export const accountCreditsV4 = pgTable('account_credits_v4', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull(),
  currency: text('currency').notNull(),
  amount_minor: integer('amount_minor').notNull(),
  source_payment_id: text('source_payment_id'),
  status: text('status').notNull().default('available'),
  created_at: timestamp('created_at').notNull().defaultNow(),
});

export const receiptsV4 = pgTable('receipts_v4', {
  id: text('id').primaryKey(),
  receipt_number: text('receipt_number').notNull(),
  payment_id: text('payment_id').notNull(),
  issued_at: timestamp('issued_at').notNull().defaultNow(),
  document_key: text('document_key'),
}, (t) => [
  uniqueIndex('idx_receipts_v4_num_unique').on(t.receipt_number),
]);

export const refundsV4 = pgTable('refunds_v4', {
  id: text('id').primaryKey(),
  invoice_id: text('invoice_id').notNull(),
  payment_id: text('payment_id').notNull(),
  amount_minor: integer('amount_minor').notNull(),
  reason: text('reason').notNull(),
  requested_by: text('requested_by').notNull(),
  approved_by: text('approved_by'),
  gateway_refund_reference: text('gateway_refund_reference'),
  status: text('status').notNull().default('pending'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  approved_at: timestamp('approved_at'),
});

export const documentSequences = pgTable('document_sequences', {
  name: text('name').notNull(),
  year: integer('year').notNull(),
  next_value: integer('next_value').notNull().default(1),
}, (t) => [
  primaryKey({ columns: [t.name, t.year] }),
]);

export const feeGateDeferrals = pgTable('fee_gate_deferrals', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull(),
  invoice_id: text('invoice_id').notNull(),
  gate: text('gate').notNull(),
  deferred_at: timestamp('deferred_at').notNull().defaultNow(),
  policy: text('policy').notNull(),
  cleared_at: timestamp('cleared_at'),
}, (t) => [
  index('idx_deferrals_user').on(t.user_id),
  index('idx_deferrals_gate').on(t.gate),
]);

export const ledgerAccountsV4 = pgTable('ledger_accounts_v4', {
  id: text('id').primaryKey(),
  account_code: text('account_code').notNull(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  normal_balance: text('normal_balance').notNull(),
  is_active: integer('is_active').notNull().default(1),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('idx_ledger_accounts_v4_code').on(t.account_code),
]);

export const ledgerEntriesV4 = pgTable('ledger_entries_v4', {
  id: text('id').primaryKey(),
  journal_id: text('journal_id').notNull(),
  account_code: text('account_code').notNull(),
  debit_minor: integer('debit_minor').notNull().default(0),
  credit_minor: integer('credit_minor').notNull().default(0),
  currency: text('currency').notNull(),
  invoice_id: text('invoice_id'),
  payment_id: text('payment_id'),
  term_id: text('term_id'),
  description: text('description').notNull(),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_ledger_entries_v4_journal').on(t.journal_id),
  index('idx_ledger_entries_v4_invoice').on(t.invoice_id),
]);

export const rateCards = pgTable('rate_cards', {
  id: text('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('draft'),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('idx_rate_cards_code').on(t.code),
]);

export const rateCardLines = pgTable('rate_card_lines', {
  id: text('id').primaryKey(),
  rate_card_id: text('rate_card_id').notNull(),
  fee_level_id: text('fee_level_id').notNull(),
  fee_item_id: text('fee_item_id').notNull(),
  amount_minor: integer('amount_minor').notNull(),
  duration_months: integer('duration_months'),
  instalment_count: integer('instalment_count'),
  instalment_structure_json: text('instalment_structure_json'),
  created_at: timestamp('created_at').notNull().defaultNow(),
});

export const aidFunds = pgTable('aid_funds', {
  id: text('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  budget_base_minor: integer('budget_base_minor').notNull().default(0),
  period_from: text('period_from'),
  period_to: text('period_to'),
  restricted_to: text('restricted_to'),
  is_active: integer('is_active').notNull().default(1),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('idx_aid_funds_code').on(t.code),
]);

export const aidProgrammes = pgTable('aid_programmes', {
  id: text('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  method: text('method').notNull(),
  invoice_label: text('invoice_label').notNull(),
  public_criteria_text: text('public_criteria_text').notNull(),
  stackable: integer('stackable').notNull().default(0),
  renewable: integer('renewable').notNull().default(1),
  requires_sap: integer('requires_sap').notNull().default(1),
  status: text('status').notNull().default('draft'),
  fund_id: text('fund_id'),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('idx_aid_programmes_code').on(t.code),
]);

export const aidBands = pgTable('aid_bands', {
  id: text('id').primaryKey(),
  aid_programme_id: text('aid_programme_id').notNull(),
  band_label: text('band_label').notNull(),
  sort_order: integer('sort_order').notNull(),
  min_need_score: real('min_need_score').notNull(),
  max_need_score: real('max_need_score').notNull(),
  method: text('method').notNull(),
  percent_bps: integer('percent_bps'),
  rate_card_id: text('rate_card_id'),
  created_at: timestamp('created_at').notNull().defaultNow(),
});

export const aidCommitments = pgTable('aid_commitments', {
  id: text('id').primaryKey(),
  award_id: text('award_id').notNull(),
  fund_id: text('fund_id').notNull(),
  committed_base_minor: integer('committed_base_minor').notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
});

export const aidApplications = pgTable('aid_applications', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull(),
  aid_programme_id: text('aid_programme_id').notNull(),
  status: text('status').notNull().default('submitted'),
  submitted_at: timestamp('submitted_at').notNull().defaultNow(),
  need_score: real('need_score'),
  verification_status: text('verification_status').notNull().default('pending'),
  documents: text('documents'),
  minimal_data_json: text('minimal_data_json'),
  waitlist_rank: integer('waitlist_rank'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_aid_app_user').on(t.user_id),
]);

export const feeAwards = pgTable('fee_awards', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull(),
  aid_programme_id: text('aid_programme_id').notNull(),
  aid_application_id: text('aid_application_id'),
  method: text('method').notNull(),
  percent_bps: integer('percent_bps'),
  fixed_base_minor: integer('fixed_base_minor'),
  rate_card_id: text('rate_card_id'),
  applies_to_json: text('applies_to_json').notNull(),
  valid_from_term: text('valid_from_term'),
  valid_to_term: text('valid_to_term'),
  renewal_due: text('renewal_due'),
  conditions_json: text('conditions_json'),
  status: text('status').notNull().default('proposed'),
  reason_code: text('reason_code'),
  decided_by: text('decided_by').notNull(),
  second_approver: text('second_approver'),
  decided_at: timestamp('decided_at').notNull().defaultNow(),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_fee_awards_user').on(t.user_id),
]);

export const aidAppeals = pgTable('aid_appeals', {
  id: text('id').primaryKey(),
  award_or_application_id: text('award_or_application_id').notNull(),
  filed_at: timestamp('filed_at').notNull().defaultNow(),
  reviewer_id: text('reviewer_id').notNull(),
  outcome: text('outcome'),
  written_reason: text('written_reason'),
  resolved_at: timestamp('resolved_at'),
});

export const aidAccessLog = pgTable('aid_access_log', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull(),
  accessed_by: text('accessed_by').notNull(),
  action: text('action').notNull(),
  resource_id: text('resource_id').notNull(),
  accessed_at: timestamp('accessed_at').notNull().defaultNow(),
});

export const aidCriteriaFields = pgTable('aid_criteria_fields', {
  id: text('id').primaryKey(),
  code: text('code').notNull(),
  label: text('label').notNull(),
  is_allowed: integer('is_allowed').notNull().default(1),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('idx_aid_criteria_fields_code').on(t.code),
]);

