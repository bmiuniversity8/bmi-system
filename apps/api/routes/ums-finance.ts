/**
 * BMI UMS – Centralized Finance & Transactions Routes
 */
import { json, ok, error } from '../lib/types';
import type { Env } from '../lib/types';
import { getActiveExchangeRate, importAndActivateCbkRate, recordManualFxOverride } from '../lib/finance/fx-service';

function paginate(url: URL) {
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const perPage = Math.min(100, parseInt(url.searchParams.get('perPage') || '50'));
  return { page, perPage, offset: (page - 1) * perPage };
}

// ─── list transactions (invoices) ─────────────────────────────────────────────

export async function handleListTransactions(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { page, perPage, offset } = paginate(url);
  
  const statusFilter = url.searchParams.get('status');
  
  const filters: string[] = [];
  const bindings: unknown[] = [];
  
  if (statusFilter) {
    if (statusFilter.toLowerCase() === 'paid') {
      filters.push(`i.status = 'paid'`);
    } else if (statusFilter.toLowerCase() === 'pending') {
      filters.push(`i.status = 'unpaid'`);
    } else {
      filters.push(`i.status = ?`);
      bindings.push(statusFilter.toLowerCase());
    }
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  
  const countQuery = `SELECT COUNT(*) as count FROM invoices i ${whereClause}`;
  const countResult = await env.PLATFORM_CONTEXT!.db.prepare(countQuery).bind(...bindings).first<{ count: number }>();
  const total = countResult?.count || 0;

  const dataQuery = `
    SELECT i.*, u.first_name, u.last_name
    FROM invoices i
    LEFT JOIN users u ON i.student_id = u.id
    ${whereClause}
    ORDER BY i.created_at DESC
    LIMIT ? OFFSET ?
  `;
  
  const { results } = await env.PLATFORM_CONTEXT!.db.prepare(dataQuery).bind(...bindings, perPage, offset).all();

  const items = results.map((inv: any) => ({
    id: inv.id,
    studentId: inv.student_id,
    studentName: `${inv.first_name || ''} ${inv.last_name || ''}`.trim() || 'Unknown Student',
    amount: inv.total_billing ?? inv.amount,
    amt: inv.total_billing ?? inv.amount,
    amountBaseUsd: inv.total_base ?? inv.amount,
    currency: inv.billing_currency || 'KES',
    baseCurrency: inv.base_currency || 'USD',
    exchangeRate: inv.exchange_rate || 129.76,
    exchangeRateSource: inv.exchange_rate_source || 'CBK',
    paidAmount: inv.paid_amount || 0,
    balance: inv.balance ?? (inv.status === 'paid' ? 0 : inv.amount),
    type: inv.degree_level ? `${inv.degree_level.toUpperCase()} Tuition` : 'Tuition',
    status: inv.status === 'paid' ? 'Paid' : (inv.status === 'unpaid' ? 'Pending' : 'Failed'),
    date: inv.created_at,
    reference: inv.invoice_number || inv.id.substring(0, 8).toUpperCase(),
    invoiceNumber: inv.invoice_number,
  }));

  return json({
    success: true,
    data: items,
    total,
    page,
    perPage,
    totalPages: Math.ceil(total / perPage)
  });
}

// ─── create / update invoice (admin writes — Finance UI calls these) ───────

export async function handleCreateInvoice(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const student_id = (body.student_id || (body as any).studentId) as string;
  const amount = Number((body as any).amount ?? (body as any).amt ?? 0);
  if (!student_id || !Number.isFinite(amount) || amount <= 0) {
    return error('student_id and a positive amount are required', 400);
  }
  const term_id = ((body as any).term_id || (body as any).termId || null) as string | null;

  const { assessInvoice } = await import('../lib/fee-assessment-service');
  const assessed = await assessInvoice(env.PLATFORM_CONTEXT!.db, {
    userId: student_id,
    kind: 'adjustment',
    sourceEvent: 'manual_invoice_create',
    termId: term_id || undefined,
    chargeKey: `manual:${student_id}:${Date.now()}`,
    lines: [
      {
        feeItemCode: 'TUI-CREDIT',
        description: (body.description as string) || 'Tuition / Educational Fee Adjustment',
        overrideAmountMinor: Math.round(amount * 100),
      },
    ],
  });

  return json({ success: true, data: assessed }, 201);
}

export async function handleUpdateInvoice(request: Request, env: Env, invoiceId: string): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const sets: string[] = [];
  const vals: unknown[] = [];
  const status = (body as any).status as string | undefined;
  if (status !== undefined) {
    const norm = String(status).toLowerCase();
    const mapped = norm === 'paid' ? 'paid' : norm === 'pending' ? 'unpaid' : norm === 'failed' ? 'unpaid' : norm;
    if (!['paid', 'unpaid'].includes(mapped)) return error('status must be paid, unpaid/pending', 400);
    sets.push(`status = ?`); vals.push(mapped);
  }
  if ((body as any).amount !== undefined || (body as any).amt !== undefined) {
    sets.push(`amount = ?`); vals.push(Math.round(Number((body as any).amount ?? (body as any).amt)));
  }
  if ((body as any).due_date !== undefined || (body as any).date !== undefined) {
    sets.push(`due_date = ?`); vals.push(((body as any).due_date || (body as any).date) as string);
  }
  if (!sets.length) return error('No valid fields to update (status, amount, due_date)', 400);
  await env.PLATFORM_CONTEXT!.db.prepare(`UPDATE invoices SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, invoiceId).run();
  const row = await env.PLATFORM_CONTEXT!.db.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(invoiceId).first();
  if (!row) return error('Invoice not found', 404);
  return ok(row);
}

// ─── invoice details with lines and allocations ───────────────────────────────

export async function handleGetInvoiceDetails(env: Env, invoiceId: string): Promise<Response> {
  const db = env.PLATFORM_CONTEXT!.db;
  const invoice = await db.prepare(
    `SELECT i.*, u.first_name, u.last_name, u.email
     FROM invoices i
     LEFT JOIN users u ON i.student_id = u.id
     WHERE i.id = ? LIMIT 1`
  ).bind(invoiceId).first();

  if (!invoice) return error('Invoice not found', 404);

  const { results: lines } = await db.prepare(
    `SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY created_at ASC`
  ).bind(invoiceId).all();

  const { results: allocations } = await db.prepare(
    `SELECT pa.*, p.payment_reference, p.provider, p.paid_at 
     FROM payment_allocations pa
     JOIN payments p ON pa.payment_id = p.id
     WHERE pa.invoice_id = ?
     ORDER BY pa.created_at DESC`
  ).bind(invoiceId).all();

  return ok({
    invoice,
    lines,
    allocations,
  });
}

// ─── fee schedules, groups, items, and installments ───────────────────────────

export async function handleGetFeeSchedules(env: Env): Promise<Response> {
  const db = env.PLATFORM_CONTEXT!.db;

  const { results: schedules } = await db.prepare(
    `SELECT * FROM fee_schedules ORDER BY created_at DESC`
  ).all();

  const { results: groups } = await db.prepare(
    `SELECT * FROM fee_groups ORDER BY display_order ASC`
  ).all();

  const { results: items } = await db.prepare(
    `SELECT * FROM fee_items ORDER BY fee_group_id, amount_base DESC`
  ).all();

  const { results: installments } = await db.prepare(
    `SELECT * FROM fee_schedule_installments ORDER BY fee_item_id, period_number ASC`
  ).all();

  return ok({
    schedules,
    groups,
    items,
    installments,
  });
}

// ─── exchange rates & freshness ──────────────────────────────────────────────

export async function handleGetExchangeRates(env: Env): Promise<Response> {
  const db = env.PLATFORM_CONTEXT!.db;

  let activeRate: any = null;
  try {
    activeRate = await getActiveExchangeRate(db, 'USD', 'KES');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    activeRate = { error: msg };
  }

  const { results: rates } = await db.prepare(
    `SELECT * FROM exchange_rates ORDER BY effective_at DESC LIMIT 50`
  ).all();

  const configRows = await db.prepare(
    `SELECT key, value FROM app_config WHERE key IN ('fx_rate_source', 'fx_rate_max_age_hours', 'fx_rate_stale_policy')`
  ).all<{ key: string; value: string }>();

  const configMap: Record<string, string> = {};
  for (const c of configRows.results) {
    configMap[c.key] = c.value;
  }

  return ok({
    activeRate,
    history: rates,
    config: configMap,
  });
}

// ─── trigger CBK forex import ────────────────────────────────────────────────

export async function handleRefreshCbkRate(env: Env, actorId: string): Promise<Response> {
  const db = env.PLATFORM_CONTEXT!.db;
  try {
    const newRate = await importAndActivateCbkRate(db, actorId);
    return ok({
      message: 'CBK indicative exchange rate imported successfully',
      rate: newRate,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return error(msg, 502);
  }
}

// ─── record manual FX override ────────────────────────────────────────────────

export async function handleManualFxOverride(request: Request, env: Env, actorId: string): Promise<Response> {
  const db = env.PLATFORM_CONTEXT!.db;
  try {
    const body = await request.json() as { rate?: number; reason?: string };
    if (!body.rate || body.rate <= 0) return error('A valid positive exchange rate is required', 400);
    if (!body.reason) return error('A reason for manual override is required', 400);

    const override = await recordManualFxOverride(db, Number(body.rate), actorId, body.reason);
    return ok({
      message: 'Manual exchange rate override recorded and activated',
      rate: override,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return error(msg, 400);
  }
}

// ─── centralized finance reports ─────────────────────────────────────────────

export async function handleGetFinanceReports(env: Env): Promise<Response> {
  const db = env.PLATFORM_CONTEXT!.db;

  const totalInvoicesRow = await db.prepare(
    `SELECT COUNT(*) as count, 
            COALESCE(SUM(total_base), 0) as total_usd_billed,
            COALESCE(SUM(total_billing), 0) as total_kes_billed,
            COALESCE(SUM(paid_amount), 0) as total_kes_collected
     FROM invoices`
  ).first<{ count: number; total_usd_billed: number; total_kes_billed: number; total_kes_collected: number }>();

  const activeFx = await db.prepare(
    `SELECT rate, source, effective_at FROM exchange_rates WHERE status = 'active' LIMIT 1`
  ).first<{ rate: number; source: string; effective_at: string }>();

  // Revenue by degree level
  const { results: byLevel } = await db.prepare(
    `SELECT COALESCE(degree_level, 'other') as degree_level,
            COUNT(*) as invoice_count,
            COALESCE(SUM(total_base), 0) as billed_usd,
            COALESCE(SUM(total_billing), 0) as billed_kes,
            COALESCE(SUM(paid_amount), 0) as collected_kes,
            COALESCE(SUM(balance), 0) as balance_kes
     FROM invoices
     GROUP BY degree_level`
  ).all();

  return ok({
    overview: {
      invoicesCount: totalInvoicesRow?.count || 0,
      usdBilled: totalInvoicesRow?.total_usd_billed || 0,
      kesBilled: totalInvoicesRow?.total_kes_billed || 0,
      kesCollected: totalInvoicesRow?.total_kes_collected || 0,
      kesOutstanding: Math.max(0, (totalInvoicesRow?.total_kes_billed || 0) - (totalInvoicesRow?.total_kes_collected || 0)),
      activeRate: activeFx?.rate || 129.76,
      rateSource: activeFx?.source || 'CBK',
    },
    byLevel,
  });
}
