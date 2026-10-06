import type { IDatabase } from '@bmi/ports';


/**
 * Atomically generates a new UID using the singleton `uid_counters` table.
 * The UID format is `BMI` followed by a 9-digit padded serial number (e.g., `BMI000000001`).
 */
export async function generateUID(db: IDatabase): Promise<string> {
  // Use UPDATE ... RETURNING to ensure atomic increments on D1 and PostgreSQL
  let result = await db.prepare(
    `UPDATE uid_counters 
     SET last_serial = last_serial + 1 
     WHERE id = 1 
     RETURNING last_serial`
  ).first<{ last_serial: number }>().catch(() => null);

  // Auto-initialize singleton row if not yet present
  if (!result || result.last_serial == null) {
    result = await db.prepare(
      `INSERT INTO uid_counters (id, last_serial)
       VALUES (1, 10001)
       ON CONFLICT (id)
       DO UPDATE SET last_serial = uid_counters.last_serial + 1
       RETURNING last_serial`
    ).first<{ last_serial: number }>().catch(() => null);
  }

  if (!result || result.last_serial == null) {
    throw new Error('Failed to generate UID: uid_counters table may not be initialized');
  }

  const paddedSerial = String(result.last_serial).padStart(9, '0');
  return `BMI${paddedSerial}`;
}
