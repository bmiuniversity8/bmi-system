/**
 * BMI UMS – Communications Center Routes
 * Persists dispatch records (SMS/Email) so the Communications screen is backed
 * by the database instead of ephemeral localStorage mocks.
 */
import { ok, error, json } from '../lib/types';
import type { Env } from '../lib/types';

function paginate(url: URL) {
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const perPage = Math.min(100, parseInt(url.searchParams.get('perPage') || '50'));
  return { page, perPage, offset: (page - 1) * perPage };
}

async function ensureCommunicationsTable(env: Env) {
  try {
    await env.PLATFORM_CONTEXT!.db.prepare(`
      CREATE TABLE IF NOT EXISTS communications (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        channel TEXT NOT NULL,
        recipient TEXT NOT NULL,
        subject TEXT,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Delivered',
        sent_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
  } catch {
    // Table may already exist or running against Postgres
  }
}

export async function handleListCommunications(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { page, perPage, offset } = paginate(url);

  await ensureCommunicationsTable(env);

  try {
    const type = url.searchParams.get('type');
    const filters: string[] = ['1=1'];
    const bindings: unknown[] = [];
    if (type) { filters.push('c.type = ?'); bindings.push(type); }

    const where = `WHERE ${filters.join(' AND ')}`;
    const total = ((await env.PLATFORM_CONTEXT!.db.prepare(`SELECT COUNT(*) as c FROM communications c ${where}`).bind(...bindings).first<{ c: number }>())?.c) || 0;

    const { results } = await env.PLATFORM_CONTEXT!.db.prepare(
      `SELECT c.*, u.first_name || ' ' || u.last_name AS sent_by_name
       FROM communications c
       LEFT JOIN users u ON c.sent_by = u.id
       ${where}
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT ? OFFSET ?`
    ).bind(...bindings, perPage, offset).all();

    return json({ success: true, data: results ?? [], total, page, perPage });
  } catch (err) {
    console.warn('[handleListCommunications] Non-fatal fallback:', err);
    return json({ success: true, data: [], total: 0, page, perPage });
  }
}

export async function handleCreateCommunication(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await request.json().catch(() => null) as {
    type?: string; channel?: string; recipient?: string; subject?: string; body?: string; status?: string;
  } | null;
  if (!body) return error('Request body must be a JSON object');

  const type = body.type || 'Email';
  const channel = body.channel || 'email';
  const recipient = body.recipient;
  const subject = body.subject || null;
  const messageBody = body.body;
  const status = body.status || 'Delivered';

  if (!recipient) return error('Recipient is required', 400);
  if (!messageBody) return error('Message body is required', 400);
  if (!['SMS', 'Email'].includes(type)) return error("type must be 'SMS' or 'Email'", 400);
  if (!['sms', 'email', 'whatsapp'].includes(channel)) return error("channel must be 'sms', 'email' or 'whatsapp'", 400);

  const id = crypto.randomUUID();
  await env.PLATFORM_CONTEXT!.db.prepare(
    `INSERT INTO communications (id, type, channel, recipient, subject, body, status, sent_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, type, channel, recipient, subject, messageBody, status, userId).run();

  const row = await env.PLATFORM_CONTEXT!.db.prepare(
    `SELECT c.*, u.first_name || ' ' || u.last_name AS sent_by_name
     FROM communications c LEFT JOIN users u ON c.sent_by = u.id WHERE c.id = ?`
  ).bind(id).first();

  return ok(row, 201);
}

export async function handleDeleteCommunication(_request: Request, env: Env, id: string): Promise<Response> {
  const row = await env.PLATFORM_CONTEXT!.db.prepare(`SELECT id FROM communications WHERE id = ?`).bind(id).first();
  if (!row) return error('Communication record not found', 404);

  await env.PLATFORM_CONTEXT!.db.prepare(`DELETE FROM communications WHERE id = ?`).bind(id).run();
  return ok({ deleted: true });
}

// ─── Website Contact Submissions (Inquiries) ──────────────────────────────────

export async function handleListContactSubmissions(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { page, perPage, offset } = paginate(url);

  const status = url.searchParams.get('status');
  const search = url.searchParams.get('search');

  const filters: string[] = ['1=1'];
  const bindings: unknown[] = [];

  if (status && status !== 'all') {
    filters.push('status = ?');
    bindings.push(status);
  }

  if (search && search.trim()) {
    filters.push('(name LIKE ? OR email LIKE ? OR subject LIKE ? OR message LIKE ?)');
    const term = `%${search.trim()}%`;
    bindings.push(term, term, term, term);
  }

  const where = `WHERE ${filters.join(' AND ')}`;
  
  const total = ((await env.PLATFORM_CONTEXT!.db.prepare(`SELECT COUNT(*) as c FROM contact_submissions ${where}`).bind(...bindings).first<{ c: number }>())?.c) || 0;
  const unreadCount = ((await env.PLATFORM_CONTEXT!.db.prepare(`SELECT COUNT(*) as c FROM contact_submissions WHERE status = 'new'`).first<{ c: number }>())?.c) || 0;

  const { results } = await env.PLATFORM_CONTEXT!.db.prepare(
    `SELECT id, name, email, subject, message, ip_address, user_agent, status, created_at
     FROM contact_submissions
     ${where}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(...bindings, perPage, offset).all();

  return json({ 
    success: true, 
    data: results, 
    total, 
    unreadCount,
    page, 
    perPage 
  });
}

export async function handleUpdateContactSubmissionStatus(request: Request, env: Env, id: string): Promise<Response> {
  const body = await request.json().catch(() => null) as { status?: string } | null;
  if (!body || !body.status) return error('Status is required', 400);

  const allowedStatuses = ['new', 'read', 'replied', 'archived'];
  if (!allowedStatuses.includes(body.status)) {
    return error(`Status must be one of: ${allowedStatuses.join(', ')}`, 400);
  }

  const row = await env.PLATFORM_CONTEXT!.db.prepare(`SELECT id FROM contact_submissions WHERE id = ?`).bind(id).first();
  if (!row) return error('Contact submission not found', 404);

  await env.PLATFORM_CONTEXT!.db.prepare(
    `UPDATE contact_submissions SET status = ? WHERE id = ?`
  ).bind(body.status, id).run();

  const updated = await env.PLATFORM_CONTEXT!.db.prepare(`SELECT * FROM contact_submissions WHERE id = ?`).bind(id).first();
  return ok(updated);
}

export async function handleDeleteContactSubmission(_request: Request, env: Env, id: string): Promise<Response> {
  const row = await env.PLATFORM_CONTEXT!.db.prepare(`SELECT id FROM contact_submissions WHERE id = ?`).bind(id).first();
  if (!row) return error('Contact submission not found', 404);

  await env.PLATFORM_CONTEXT!.db.prepare(`DELETE FROM contact_submissions WHERE id = ?`).bind(id).run();
  return ok({ deleted: true });
}