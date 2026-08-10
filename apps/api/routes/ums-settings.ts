/**
 * BMI UMS – System Settings Routes
 * Persists institutional preferences in the `system_settings` table so the
 * admin Settings screen no longer relies on client-side localStorage.
 */
import { ok, error, json, typedJson } from '../lib/types';
import type { Env } from '../lib/types';

export async function handleGetSystemSettings(_request: Request, env: Env): Promise<Response> {
  const { results } = await env.PLATFORM_CONTEXT!.db.prepare(`SELECT key, value, updated_at FROM system_settings`).all<{ key: string; value: string; updated_at: string }>();
  const settings: Record<string, string> = {};
  const meta: Record<string, string> = {};
  for (const row of results) {
    settings[row.key] = row.value;
    meta[row.key] = row.updated_at;
  }
  return json({ success: true, data: settings, updatedAt: meta });
}

export async function handleUpdateSystemSettings(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await typedJson<Record<string, unknown>>(request);
  const updates: string[] = [];
  const bindings: unknown[] = [];

  for (const [key, value] of Object.entries(body)) {
    if (typeof key !== 'string' || !key || key.length > 100) continue;
    if (value === null || value === undefined) continue;
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    updates.push(key);
    bindings.push(serialized);
  }

  if (updates.length === 0) return error('No valid settings provided', 400);

  // Upsert each provided key
  for (let i = 0; i < updates.length; i++) {
    await env.PLATFORM_CONTEXT!.db.prepare(
      `INSERT INTO system_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
    ).bind(updates[i], bindings[i], userId).run();
  }

  const settings: Record<string, string> = {};
  const { results } = await env.PLATFORM_CONTEXT!.db.prepare(`SELECT key, value FROM system_settings`).all<{ key: string; value: string }>();
  for (const row of results) settings[row.key] = row.value;

  return ok({ saved: updates.length, settings });
}

export async function handleResetSystemSettings(_request: Request, env: Env): Promise<Response> {
  await env.PLATFORM_CONTEXT!.db.prepare(`DELETE FROM system_settings`).run();
  return ok({ reset: true });
}