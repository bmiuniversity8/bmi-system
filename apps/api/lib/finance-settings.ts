/**
 * Finance Settings Accessor & Validator (Fees System v4)
 *
 * Rules:
 * - Every amount, rate, percentage, day count, threshold, label comes from the DB.
 * - getFinanceSetting has NO default parameter.
 * - A missing key fails closed by throwing FinanceSettingMissingError.
 * - Writes record to finance_settings_history.
 */

export class FinanceSettingMissingError extends Error {
  constructor(key: string) {
    super(`Required finance setting "${key}" is not configured in the database.`);
    this.name = 'FinanceSettingMissingError';
  }
}

export class FinanceSettingValidationError extends Error {
  constructor(key: string, reason: string) {
    super(`Invalid finance setting value for "${key}": ${reason}`);
    this.name = 'FinanceSettingValidationError';
  }
}

export async function getFinanceSetting<T>(db: any, key: string): Promise<T> {
  const row = await (db.prepare(
    `SELECT value_json, value_type FROM finance_settings WHERE key = ? LIMIT 1`
  ).bind(key).first() as Promise<{ value_json: string; value_type: string } | null>).catch(() => null);

  if (!row || row.value_json === null || row.value_json === undefined) {
    throw new FinanceSettingMissingError(key);
  }

  try {
    return JSON.parse(row.value_json) as T;
  } catch (e: unknown) {
    throw new FinanceSettingValidationError(key, `Malformed JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function getInstitutionSetting(db: any, key: string): Promise<string> {
  const row = await (db.prepare(
    `SELECT value FROM institution_settings WHERE key = ? LIMIT 1`
  ).bind(key).first() as Promise<{ value: string } | null>).catch(() => null);

  if (!row || row.value === null || row.value === undefined) {
    throw new FinanceSettingMissingError(`institution.${key}`);
  }

  return row.value;
}

export async function setFinanceSetting(
  db: any,
  key: string,
  value: unknown,
  updatedBy: string
): Promise<void> {
  const existing = await (db.prepare(
    `SELECT value_json FROM finance_settings WHERE key = ? LIMIT 1`
  ).bind(key).first() as Promise<{ value_json: string } | null>).catch(() => null);

  const serialized = JSON.stringify(value);
  const now = new Date().toISOString();
  const histId = `fsh_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  if (existing) {
    await db.prepare(
      `UPDATE finance_settings SET value_json = ?, updated_by = ?, updated_at = ? WHERE key = ?`
    ).bind(serialized, updatedBy, now, key).run();

    await db.prepare(
      `INSERT INTO finance_settings_history (id, key, old_value_json, new_value_json, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(histId, key, existing.value_json, serialized, updatedBy, now).run();
  } else {
    const valType = typeof value;
    await db.prepare(
      `INSERT INTO finance_settings (key, value_json, value_type, description, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(key, serialized, valType, '', updatedBy, now).run();

    await db.prepare(
      `INSERT INTO finance_settings_history (id, key, old_value_json, new_value_json, updated_by, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?)`
    ).bind(histId, key, serialized, updatedBy, now).run();
  }
}
