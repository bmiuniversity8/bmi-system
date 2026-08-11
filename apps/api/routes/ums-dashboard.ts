/**
 * BMI UMS – Dashboard Analytics Routes
 */
import { ok } from '../lib/types';
import type { Env } from '../lib/types';

export async function handleGetRevenueTrend(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const monthsStr = url.searchParams.get('months') || '6';
  const months = parseInt(monthsStr, 10);

  // We want to return an array of { month: 'Jan', revenue: 1000 }
  // We'll calculate the last N months, including current month.

  const result = [];
  const now = new Date();
  
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthName = monthNames[d.getMonth()];
    
    // SQLite formatting: strftime('%Y-%m', created_at)
    const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    
    // Sum amount where status = 'paid' for this month
    const query = `
      SELECT SUM(amount) as revenue 
      FROM invoices 
      WHERE status = 'paid' 
      AND strftime('%Y-%m', created_at) = ?
    `;
    
    const row = await env.PLATFORM_CONTEXT!.db.prepare(query).bind(yearMonth).first<{ revenue: number }>();
    const revenue = row?.revenue || 0;
    
    result.push({
      month: monthName,
      revenue
    });
  }

  // ok(result) produces { success: true, data: result }
  // Dashboard checks Array.isArray(d.data) so data must be the array itself
  return ok(result);
}

export async function handleGetDashboardStats(_request: Request, env: Env): Promise<Response> {
  const db = env.PLATFORM_CONTEXT!.db;

  let pending_leaves = 0;
  try {
    const row = await db.prepare(`SELECT COUNT(*) as c FROM hr_leave_requests WHERE status='pending'`).first<{ c: number }>();
    pending_leaves = row?.c || 0;
  } catch (e) {
    pending_leaves = 0;
  }

  let overdue_books = 0;
  try {
    const row = await db.prepare(`SELECT COUNT(*) as c FROM library_borrowings WHERE due_date < date('now') AND status='borrowed'`).first<{ c: number }>();
    overdue_books = row?.c || 0;
  } catch (e) {
    overdue_books = 0;
  }

  let unpaid_fines = 0;
  try {
    const row = await db.prepare(`SELECT COALESCE(SUM(amount), 0) as s FROM library_fines WHERE paid=0`).first<{ s: number }>();
    unpaid_fines = row?.s || 0;
  } catch (e) {
    unpaid_fines = 0;
  }

  let upcoming_events = 0;
  try {
    const row = await db.prepare(`SELECT COUNT(*) as c FROM academic_terms WHERE start_date >= date('now') AND start_date <= date('now', '+30 days')`).first<{ c: number }>();
    upcoming_events = row?.c || 0;
  } catch (e) {
    upcoming_events = 0;
  }

  return ok({ pending_leaves, overdue_books, unpaid_fines, upcoming_events });
}

export async function handleGetUpcomingDeadlines(_request: Request, env: Env): Promise<Response> {
  const db = env.PLATFORM_CONTEXT!.db;
  const deadlines: Array<{ title: string; date: string; type: string; tag: string; color: string }> = [];

  try {
    const { results } = await db.prepare(`
      SELECT name, start_date, end_date, status
      FROM academic_terms
      WHERE (start_date >= date('now') AND start_date <= date('now', '+60 days'))
         OR (end_date >= date('now') AND end_date <= date('now', '+60 days'))
    `).all<{ name: string; start_date: string; end_date: string; status: string }>();

    const now = new Date();
    const nowStr = now.toISOString().split('T')[0];

    for (const row of results) {
      const dates: Array<{ date: string; label: string }> = [];

      if (row.start_date >= nowStr) {
        dates.push({ date: row.start_date, label: `${row.name} - Start` });
      }
      if (row.end_date >= nowStr && row.end_date !== row.start_date) {
        dates.push({ date: row.end_date, label: `${row.name} - End` });
      }

      for (const d of dates) {
        const targetDate = new Date(d.date);
        const diffMs = targetDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        let type = 'Administrative';
        const s = (row.status || '').toLowerCase();
        if (s === 'exam') {
          type = 'Exams';
        } else if (s === 'active' || s === 'registration') {
          type = 'Academic';
        }

        const isUrgent = diffDays < 10;
        const tag = isUrgent ? 'Urgent' : 'Scheduled';
        const color = isUrgent
          ? 'text-amber-500 bg-amber-500/10 border-amber-500/20'
          : 'text-blue-500 bg-blue-500/10 border-blue-500/20';

        deadlines.push({
          title: d.label,
          date: d.date,
          type,
          tag,
          color,
        });
      }
    }
  } catch (e) {
    // missing table or error – return empty
  }

  deadlines.sort((a, b) => a.date.localeCompare(b.date));

  return ok(deadlines);
}

export async function handleRegisterTranscript(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as {
      studentId?: string;
      studentName?: string;
      program?: string;
      academicYear?: string;
      contentHash?: string;
    };

    if (!body.studentId || !body.contentHash) {
      return ok({
        serialNumber: `BMI-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
        issuedAt: new Date().toISOString(),
        verificationUrl: `${(env as any).PORTAL_URL || 'https://bmi-portal.pages.dev'}/verify/transcript/fallback`,
        hiddenToken: crypto.randomUUID(),
      });
    }

    const serialNumber = `BMI-${new Date().getFullYear()}-${body.studentId.substring(0, 6).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const issuedAt = new Date().toISOString();
    const verificationUrl = `${(env as any).PORTAL_URL || 'https://bmi-portal.pages.dev'}/verify/transcript/${serialNumber}`;
    const hiddenToken = crypto.randomUUID();

    // Store in DB if available (non-blocking — failure falls back gracefully on frontend)
    try {
      const db = env.PLATFORM_CONTEXT?.db;
      if (db) {
        await db.prepare(`
          INSERT INTO transcript_registry (serial_number, student_id, student_name, program, academic_year, content_hash, verification_url, hidden_token, issued_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (serial_number) DO NOTHING
        `).bind(
          serialNumber,
          body.studentId,
          body.studentName ?? '',
          body.program ?? '',
          body.academicYear ?? '',
          body.contentHash,
          verificationUrl,
          hiddenToken,
          issuedAt,
        ).run();
      }
    } catch {
      // Table may not exist yet — frontend falls back to client-side serial gracefully
    }

    return ok({ serialNumber, issuedAt, verificationUrl, hiddenToken });
  } catch {
    return ok({
      serialNumber: `BMI-${Date.now()}`,
      issuedAt: new Date().toISOString(),
      verificationUrl: `${(env as any).PORTAL_URL || 'https://bmi-portal.pages.dev'}/verify/transcript/fallback`,
      hiddenToken: crypto.randomUUID(),
    });
  }
}
