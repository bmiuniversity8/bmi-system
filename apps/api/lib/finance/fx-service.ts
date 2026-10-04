import type { IDatabase } from '@bmi/ports';
import { fetchCbkExchangeRate } from './cbk-importer';

export interface ExchangeRateRecord {
  id: string;
  base_currency: string;
  quote_currency: string;
  rate: number;
  rate_type: string;
  source: string;
  source_reference: string | null;
  status: string;
  published_at: string | null;
  effective_at: string;
  retrieved_at: string;
  created_at: string;
}

/**
 * Retrieve the active exchange rate for a currency pair from the database.
 * Enforces rate freshness checks based on institutional app_config.
 */
export async function getActiveExchangeRate(
  db: IDatabase,
  baseCurrency = 'USD',
  quoteCurrency = 'KES'
): Promise<ExchangeRateRecord> {
  const rateRow = await db.prepare(
    `SELECT * FROM exchange_rates 
     WHERE base_currency = ? AND quote_currency = ? AND status = 'active'
     ORDER BY effective_at DESC LIMIT 1`
  ).bind(baseCurrency, quoteCurrency).first<ExchangeRateRecord>();

  if (!rateRow) {
    throw new Error(
      `No active exchange rate found in database for pair ${baseCurrency}/${quoteCurrency}. Institutional rate import or configuration required.`
    );
  }

  // Check freshness configuration
  const maxAgeConfig = await db.prepare(
    `SELECT value FROM app_config WHERE key = 'fx_rate_max_age_hours' LIMIT 1`
  ).first<{ value: string }>().catch(() => null);
  
  const maxAgeHours = maxAgeConfig?.value ? parseFloat(maxAgeConfig.value) : 72; // Default 72h covers weekends/holidays

  const effectiveTime = new Date(rateRow.effective_at).getTime();
  const now = Date.now();
  const ageHours = (now - effectiveTime) / (1000 * 60 * 60);

  if (ageHours > maxAgeHours) {
    const stalePolicyConfig = await db.prepare(
      `SELECT value FROM app_config WHERE key = 'fx_rate_stale_policy' LIMIT 1`
    ).first<{ value: string }>().catch(() => null);
    
    const stalePolicy = stalePolicyConfig?.value || 'BLOCK_NEW_INVOICE';

    if (stalePolicy === 'BLOCK_NEW_INVOICE') {
      // Check if an authorized manual override is currently active
      if (rateRow.source !== 'MANUAL') {
        throw new Error(
          `Exchange rate ${baseCurrency}/${quoteCurrency} is stale (${Math.round(ageHours)}h old, exceeds maximum ${maxAgeHours}h). New invoice issuance is blocked until a fresh CBK rate is imported or an authorized finance override is approved.`
        );
      }
    }
  }

  return rateRow;
}

/**
 * Import the latest CBK rate and activate it in the database.
 */
export async function importAndActivateCbkRate(
  db: IDatabase,
  actorId?: string,
  fetchImpl: typeof fetch = fetch
): Promise<ExchangeRateRecord> {
  const cbkRate = await fetchCbkExchangeRate(fetchImpl);
  const newId = `fx-cbk-${Date.now()}`;
  const nowIso = new Date().toISOString();

  // Supersede existing active rates for the pair
  await db.prepare(
    `UPDATE exchange_rates SET status = 'superseded' 
     WHERE base_currency = ? AND quote_currency = ? AND status = 'active'`
  ).bind(cbkRate.baseCurrency, cbkRate.quoteCurrency).run();

  // Insert new active rate
  await db.prepare(
    `INSERT INTO exchange_rates 
     (id, base_currency, quote_currency, rate, rate_type, source, source_reference, status, published_at, effective_at, retrieved_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`
  ).bind(
    newId,
    cbkRate.baseCurrency,
    cbkRate.quoteCurrency,
    cbkRate.rate,
    cbkRate.rateType,
    cbkRate.source,
    cbkRate.sourceReference,
    cbkRate.publishedAt,
    cbkRate.effectiveAt,
    nowIso,
    nowIso
  ).run();

  // Audit log
  await db.prepare(
    `INSERT INTO financial_audit_log (id, action, actor_id, target_type, target_id, old_value, new_value, reason, source, created_at)
     VALUES (?, 'fx_change', ?, 'exchange_rate', ?, NULL, ?, 'CBK daily automated forex import', 'CBK', ?)`
  ).bind(
    `fa-${Date.now()}`,
    actorId || 'system',
    newId,
    String(cbkRate.rate),
    nowIso
  ).run();

  const inserted = await db.prepare(
    `SELECT * FROM exchange_rates WHERE id = ? LIMIT 1`
  ).bind(newId).first<ExchangeRateRecord>();

  return inserted!;
}

/**
 * Record an authorized manual FX rate override.
 */
export async function recordManualFxOverride(
  db: IDatabase,
  rate: number,
  actorId: string,
  reason: string,
  baseCurrency = 'USD',
  quoteCurrency = 'KES'
): Promise<ExchangeRateRecord> {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('Exchange rate must be a positive number');
  }
  if (!reason || reason.trim().length < 5) {
    throw new Error('A detailed reason is required to approve a manual exchange rate override');
  }

  const newId = `fx-manual-${Date.now()}`;
  const nowIso = new Date().toISOString();

  // Supersede existing active rates for the pair
  await db.prepare(
    `UPDATE exchange_rates SET status = 'superseded' 
     WHERE base_currency = ? AND quote_currency = ? AND status = 'active'`
  ).bind(baseCurrency, quoteCurrency).run();

  await db.prepare(
    `INSERT INTO exchange_rates 
     (id, base_currency, quote_currency, rate, rate_type, source, source_reference, status, published_at, effective_at, retrieved_at, created_at)
     VALUES (?, ?, ?, ?, 'MANUAL', 'MANUAL', ?, 'active', ?, ?, ?, ?)`
  ).bind(
    newId,
    baseCurrency,
    quoteCurrency,
    rate,
    `Manual override by actor ${actorId}`,
    nowIso,
    nowIso,
    nowIso,
    nowIso
  ).run();

  // Audit log
  await db.prepare(
    `INSERT INTO financial_audit_log (id, action, actor_id, target_type, target_id, old_value, new_value, reason, source, created_at)
     VALUES (?, 'fx_manual_override', ?, 'exchange_rate', ?, NULL, ?, ?, 'MANUAL', ?)`
  ).bind(
    `fa-${Date.now()}`,
    actorId,
    newId,
    String(rate),
    reason.trim(),
    nowIso
  ).run();

  const inserted = await db.prepare(
    `SELECT * FROM exchange_rates WHERE id = ? LIMIT 1`
  ).bind(newId).first<ExchangeRateRecord>();

  return inserted!;
}
