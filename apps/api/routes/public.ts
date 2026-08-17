/**
 * worker/routes/public.ts
 *
 * Unauthenticated, read-only public API endpoints consumed by:
 *   - bmi-university (marketing site) for programs, stats, CMS content
 *   - Any third party with valid CORS origin
 *
 * All responses are cache-friendly (5-min CDN TTL).
 */

import { error } from '../lib/types';
import type { Env } from '../lib/types';

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
  'Surrogate-Control': 'max-age=3600',
};

function cachedOk<T>(data: T): Response {
  const body = JSON.stringify({ success: true, data });
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...CACHE_HEADERS,
    },
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a normalized { level → seats } map summed per-program for capacity/availability. */
async function buildProgramSeatMap(env: Env): Promise<Map<string, { capacity: number; enrolled: number }>> {
  const seatMap = new Map<string, { capacity: number; enrolled: number }>();
  try {
    // Aggregate seat counts per program via the program_id foreign key on courses
    const courseCounts = await env.PLATFORM_CONTEXT!.db.prepare(
      `SELECT c.program_id,
              SUM(c.capacity)                                                   AS capacity,
              COUNT(CASE WHEN e.status = 'enrolled' THEN 1 END)                AS enrolled
       FROM courses c
       LEFT JOIN enrollments e ON e.course_id = c.id
       WHERE c.is_active = 1
       GROUP BY c.program_id`,
    ).all<{ program_id: string | null; capacity: number | null; enrolled: number | null }>();

    for (const row of (courseCounts?.results ?? [])) {
      if (!row.program_id) continue;
      seatMap.set(row.program_id, {
        capacity: row.capacity ?? 0,
        enrolled: row.enrolled ?? 0,
      });
    }
  } catch (err) {
    console.warn('[buildProgramSeatMap] Failed to aggregate seat counts (non-fatal):', err);
  }
  return seatMap;
}

// ── Public Handlers ──────────────────────────────────────────────────────────

/**
 * GET /api/public/programs — full program catalog with live seat availability.
 *
 * SOURCE OF TRUTH: the database `programs` table (single source of truth).
 * Fallbacks gracefully if database query is temporarily unavailable.
 *
 * Optional query params:
 *   - level: 'undergraduate' | 'graduate' | 'doctorate' | 'certificate'
 */
export async function handlePublicPrograms(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const level = url.searchParams.get('level');

  const cacheUrl = new URL(request.url);
  cacheUrl.search = '';
  const cacheKey = new Request(cacheUrl.toString(), request);
  const cache = caches.default;

  // 1. Try Cache API first
  try {
    const cachedRes = await cache.match(cacheKey);
    if (cachedRes) {
      if (!level) return cachedRes;
      type ProgramItem = { level: string;[key: string]: unknown };
      const body = await cachedRes.clone().json<{ success: boolean; data: ProgramItem[] }>();
      const filtered = body.data.filter(p => p.level === level);
      return new Response(JSON.stringify({ success: true, data: filtered }), {
        status: 200,
        headers: cachedRes.headers,
      });
    }
  } catch (cacheErr) {
    console.warn('[handlePublicPrograms] Cache match error:', cacheErr);
  }

  try {
    const [programRowsResult, seatMap] = await Promise.allSettled([
      env.PLATFORM_CONTEXT!.db.prepare(
        `SELECT p.id, p.name, p.code, p.level, p.description, p.icon,
                p.total_credit_hours AS credits, p.duration_years, p.mode_of_study,
                d.name  AS department,
                f.name  AS faculty,
                f.id    AS faculty_id,
                d.id    AS department_id
         FROM programs p
         LEFT JOIN departments d ON d.id = p.department_id
         LEFT JOIN faculties   f ON f.id = d.faculty_id
         WHERE p.is_active = 1
         ORDER BY
           CASE p.level
             WHEN 'undergraduate' THEN 1
             WHEN 'graduate'      THEN 2
             WHEN 'doctorate'     THEN 3
             WHEN 'certificate'   THEN 4
             ELSE 5
           END,
           p.name`,
      ).all<{
        id: string; name: string; code: string; level: string;
        description: string | null; icon: string | null;
        credits: number; duration_years: number; mode_of_study: string;
        department: string | null; faculty: string | null;
        department_id: string | null; faculty_id: string | null;
      }>(),
      buildProgramSeatMap(env),
    ]);

    const activeSeatMap = seatMap.status === 'fulfilled' ? seatMap.value : new Map<string, { capacity: number; enrolled: number }>();
    const rawPrograms = programRowsResult.status === 'fulfilled' ? (programRowsResult.value?.results ?? []) : [];

    let programs = rawPrograms.map((row) => {
      const seats = activeSeatMap.get(row.id);
      const availableSeats = seats ? Math.max(0, seats.capacity - seats.enrolled) : null;
      return {
        id: row.id,
        code: row.code,
        label: row.name,
        name: row.name,
        level: row.level,
        description: row.description,
        icon: row.icon,
        credits: row.credits,
        duration_years: row.duration_years,
        mode_of_study: row.mode_of_study,
        department: row.department,
        department_id: row.department_id,
        faculty: row.faculty,
        faculty_id: row.faculty_id,
        available_seats: availableSeats,
      };
    });

    const responseToCache = cachedOk(programs);

    try {
      if (ctx) {
        ctx.waitUntil(cache.put(cacheKey, responseToCache.clone()));
      } else {
        await cache.put(cacheKey, responseToCache.clone()).catch(() => { });
      }
    } catch {
      // Ignore cache put errors
    }

    if (level) {
      programs = programs.filter((p) => p.level === level);
      return cachedOk(programs);
    }

    return responseToCache;
  } catch (err) {
    console.error('[handlePublicPrograms] DB fetch failed:', err);
    return cachedOk([]);
  }
}

/** GET /api/public/faculties — public list of active faculties (for marketing & dropdowns). */
export async function handlePublicFaculties(_request: Request, env: Env): Promise<Response> {
  const { results } = await env.PLATFORM_CONTEXT!.db.prepare(
    `SELECT id, name, code, description FROM faculties WHERE is_active = 1 ORDER BY name`,
  ).all();
  return cachedOk(results);
}

/** GET /api/public/departments — public list of active departments. Optional ?facultyId= filter. */
export async function handlePublicDepartments(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const facultyId = url.searchParams.get('facultyId');
  let query = `SELECT id, name, code, faculty_id, description FROM departments WHERE is_active = 1`;
  const bindings: unknown[] = [];
  if (facultyId) { query += ` AND faculty_id = ?`; bindings.push(facultyId); }
  query += ` ORDER BY name`;
  const { results } = await env.PLATFORM_CONTEXT!.db.prepare(query).bind(...bindings).all();
  return cachedOk(results);
}

/** GET /api/public/stats — aggregate counts, no PII */
export async function handlePublicStats(_request: Request, env: Env): Promise<Response> {
  const [programCount, studentCount, appCount] = await Promise.all([
    env.PLATFORM_CONTEXT!.db.prepare(`SELECT COUNT(*) AS n FROM courses`).first<{ n: number }>(),
    env.PLATFORM_CONTEXT!.db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'student'`).first<{ n: number }>(),
    env.PLATFORM_CONTEXT!.db.prepare(
      `SELECT COUNT(*) AS n FROM applications WHERE submitted_at >= date('now', '-90 days')`,
    ).first<{ n: number }>(),
  ]);

  return cachedOk({
    total_programs: programCount?.n ?? 0,
    total_enrolled_students: studentCount?.n ?? 0,
    total_applications_this_term: appCount?.n ?? 0,
  });
}

/** GET /api/public/cms/posts — paginated published posts */
export async function handlePublicListPosts(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'));
  const perPage = Math.min(50, Math.max(1, parseInt(url.searchParams.get('per_page') ?? '10')));
  const offset = (page - 1) * perPage;

  const [rows, total] = await Promise.all([
    env.PLATFORM_CONTEXT!.db.prepare(
      `SELECT p.id, p.title, p.slug, p.excerpt, p.tags, p.published_at,
              u.first_name, u.last_name
       FROM cms_posts p
       JOIN users u ON u.id = p.author_id
       WHERE p.status = 'published'
       ORDER BY p.published_at DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(perPage, offset)
      .all<{
        id: string; title: string; slug: string; excerpt: string | null;
        tags: string | null; published_at: string; first_name: string; last_name: string;
      }>(),
    env.PLATFORM_CONTEXT!.db.prepare(
      `SELECT COUNT(*) AS n FROM cms_posts WHERE status = 'published'`,
    ).first<{ n: number }>(),
  ]);

  const posts = rows.results.map((r) => ({
    id: r.id,
    title: r.title,
    slug: r.slug,
    excerpt: r.excerpt,
    tags: r.tags ? JSON.parse(r.tags) : null,
    published_at: r.published_at,
    author: { first_name: r.first_name, last_name: r.last_name },
  }));

  return cachedOk({
    results: posts,
    total: total?.n ?? 0,
    page,
    per_page: perPage,
    total_pages: Math.ceil((total?.n ?? 0) / perPage),
  });
}

/** GET /api/public/cms/posts/:slug — single published post */
export async function handlePublicGetPost(
  _request: Request,
  env: Env,
  slug: string,
): Promise<Response> {
  const row = await env.PLATFORM_CONTEXT!.db.prepare(
    `SELECT p.id, p.title, p.slug, p.excerpt, p.content, p.tags, p.published_at,
            u.first_name, u.last_name
     FROM cms_posts p
     JOIN users u ON u.id = p.author_id
     WHERE p.slug = ? AND p.status = 'published'`,
  )
    .bind(slug)
    .first<{
      id: string; title: string; slug: string; excerpt: string | null;
      content: string | null; tags: string | null; published_at: string;
      first_name: string; last_name: string;
    }>();

  if (!row) return error('Post not found', 404);

  return cachedOk({
    ...row,
    tags: row.tags ? JSON.parse(row.tags) : null,
    author: { first_name: row.first_name, last_name: row.last_name },
  });
}

/** GET /api/public/cms/pages/:slug — single published page */
export async function handlePublicGetPage(
  _request: Request,
  env: Env,
  slug: string,
): Promise<Response> {
  const row = await env.PLATFORM_CONTEXT!.db.prepare(
    `SELECT id, title, slug, content, published_at
     FROM cms_pages
     WHERE slug = ? AND status = 'published'`,
  )
    .bind(slug)
    .first<{ id: string; title: string; slug: string; content: string | null; published_at: string }>();

  if (!row) return error('Page not found', 404);
  return cachedOk(row);
}

/** POST /api/public/contact — store contact form submission from marketing site */
export async function handlePublicContact(request: Request, env: Env): Promise<Response> {
  let body: { name?: unknown; email?: unknown; subject?: unknown; message?: unknown };
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON', 400);
  }

  const { name, email, subject, message } = body;

  // Basic validation
  if (
    typeof name !== 'string' || name.trim().length === 0 ||
    typeof email !== 'string' || !email.includes('@') ||
    typeof subject !== 'string' || subject.trim().length === 0 ||
    typeof message !== 'string' || message.trim().length === 0
  ) {
    return error('Missing or invalid required fields: name, email, subject, message', 422);
  }

  if (name.trim().length > 200 || subject.trim().length > 500 || message.trim().length > 5000) {
    return error('Field length exceeds maximum allowed', 422);
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For') ?? null;
  const userAgent = request.headers.get('User-Agent') ?? null;

  try {
    await env.PLATFORM_CONTEXT!.db.prepare(
      `INSERT INTO contact_submissions (name, email, subject, message, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      name.trim(),
      email.trim().toLowerCase(),
      subject.trim(),
      message.trim(),
      ip,
      userAgent,
    ).run();
  } catch (err) {
    console.error('[contact] DB insert failed:', err);
    return error('Failed to save your submission. Please try again.', 500);
  }

  return new Response(JSON.stringify({ success: true, message: 'Your message has been received. We will be in touch within 1–2 business days.' }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** POST /api/public/newsletter — subscribe an email to the newsletter */
export async function handlePublicNewsletter(request: Request, env: Env): Promise<Response> {
  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON', 400);
  }

  const { email } = body;

  if (typeof email !== 'string' || !email.includes('@') || email.length > 254) {
    return error('A valid email address is required', 422);
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    // UPSERT: if already subscribed, reactivate; otherwise insert
    await env.PLATFORM_CONTEXT!.db.prepare(
      `INSERT INTO newsletter_subscribers (email, source)
       VALUES (?, 'website_footer')
       ON CONFLICT(email) DO UPDATE SET
         status = 'active',
         unsubscribed_at = NULL`,
    ).bind(normalizedEmail).run();
  } catch (err) {
    console.error('[newsletter] DB insert failed:', err);
    return error('Failed to subscribe. Please try again.', 500);
  }

  return new Response(JSON.stringify({ success: true, message: 'You are now subscribed to BMI University news and updates.' }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}
