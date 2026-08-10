/**
 * BMI UMS – Certificate Verification Logs Routes
 * Backs the admin Verification Dashboard's activity table with real DB data
 * instead of frontend mock arrays.
 */
import { ok } from '../lib/types';
import type { Env } from '../lib/types';

function paginate(url: URL) {
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const perPage = Math.min(100, parseInt(url.searchParams.get('perPage') || '50'));
  return { page, perPage, offset: (page - 1) * perPage };
}

export async function handleListVerificationLogs(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { page, perPage, offset } = paginate(url);

  const serial = url.searchParams.get('serial');
  const result = url.searchParams.get('result');
  const method = url.searchParams.get('method');

  const filters: string[] = ['1=1'];
  const bindings: unknown[] = [];
  if (serial) { filters.push('vl.serial_number LIKE ?'); bindings.push(`%${serial}%`); }
  if (result) { filters.push('vl.result = ?'); bindings.push(result); }
  if (method) { filters.push('vl.method = ?'); bindings.push(method); }

  const where = `WHERE ${filters.join(' AND ')}`;
  const total = ((await env.PLATFORM_CONTEXT!.db.prepare(`SELECT COUNT(*) as c FROM verification_logs vl ${where}`).bind(...bindings).first<{ c: number }>())?.c) || 0;

  const { results } = await env.PLATFORM_CONTEXT!.db.prepare(
    `SELECT vl.* FROM verification_logs vl ${where} ORDER BY vl.created_at DESC, vl.id DESC LIMIT ? OFFSET ?`
  ).bind(...bindings, perPage, offset).all();

  return ok({ items: results, total, page, perPage });
}