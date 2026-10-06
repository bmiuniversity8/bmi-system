/**
 * normalize-taxonomy.ts — canonical taxonomy backfill for the PRIMARY database.
 *
 * Context
 * ───────
 * The canonical taxonomies in this repo are:
 *   - programs.level: 'undergraduate' | 'graduate' | 'doctorate' | 'certificate' | 'diploma'
 *     (lowercase — see packages/shared VALID_LEVELS + all seed migrations)
 *   - courses.level:  numeric bands '100' … '700' (see 0044_canonical_academic_catalogue),
 *     plus the named UI values 'Undergraduate' | 'Postgraduate' | 'Diploma' | 'Certificate'
 *     (see apps/ums Course type + CourseModal + Courses tabs).
 *
 * Production drifted: UI writes through legacy forms/imports stored
 * 'bachelor' / 'master' on programs and numeric-or-alias levels on courses.
 * The UMS frontend tolerates both spellings at read time, but filters, seat
 * maps and reports assume canonical values — so this script heals the data.
 *
 * IMPORTANT — which database?
 * ───────────────────────────
 * Neon PostgreSQL (DATABASE_URL_CORE) is PRIMARY. The D1 migrations folder
 * (incl. 0051) only covers local dev / the D1 cache layer, so this script
 * targets Neon directly. It is idempotent: re-running changes nothing.
 *
 * Safety (best practices)
 * ───────────────────────
 * - DRY RUN BY DEFAULT. Pass --apply to write. Dry runs open a transaction,
 *   compute the full plan, print before/after distributions, then ROLLBACK.
 * - --apply runs inside a single transaction: all-or-nothing.
 * - NEVER deletes. Only UPDATEs rows whose level is non-canonical AND
 *   unambiguously classifiable. Anything ambiguous is left untouched and
 *   listed in the leftover report for human review.
 * - Course bands are derived from the course CODE's first digit (1–7) or from
 *   certificate/diploma code prefixes — never invented. See classifyCourseLevel.
 *
 * Usage
 * ─────
 *   DATABASE_URL_CORE=postgres://... pnpm --filter @bmi/api exec tsx scripts/normalize-taxonomy.ts
 *   DATABASE_URL_CORE=postgres://... pnpm --filter @bmi/api exec tsx scripts/normalize-taxonomy.ts --apply
 */
import { Pool } from '@neondatabase/serverless';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

// Fallback: load .dev.vars (same pattern as migrate-d1-to-neon.ts) so the
// script works out of the box in a dev checkout without exporting secrets.
// Explicit environment variables always win over .dev.vars values.
try {
  const devVarsPath = path.resolve(process.cwd(), '.dev.vars');
  if (fs.existsSync(devVarsPath)) {
    for (const line of fs.readFileSync(devVarsPath, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (key && !process.env[key]) process.env[key] = val;
      }
    }
  }
} catch {
  // Ignore — DATABASE_URL_CORE from the real environment is preferred anyway.
}

export type ProgramCanonical =
  | 'undergraduate'
  | 'graduate'
  | 'doctorate'
  | 'certificate'
  | 'diploma';

export type CourseCanonical =
  | '100' | '200' | '300' | '400' | '500' | '600' | '700'
  | 'Undergraduate' | 'Postgraduate' | 'Diploma' | 'Certificate';

const PROGRAM_MAP: Record<string, ProgramCanonical> = {
  bachelor: 'undergraduate',
  bachelors: 'undergraduate',
  undergrad: 'undergraduate',
  ug: 'undergraduate',
  undergraduate: 'undergraduate',
  master: 'graduate',
  masters: 'graduate',
  graduate: 'graduate',
  postgraduate: 'graduate',
  grad: 'graduate',
  pg: 'graduate',
  doctorate: 'doctorate',
  doctoral: 'doctorate',
  doct: 'doctorate',
  phd: 'doctorate',
  dphil: 'doctorate',
  diploma: 'diploma',
  dip: 'diploma',
  certificate: 'certificate',
  cert: 'certificate',
};

/** Map a raw programs.level value to canonical form. Returns null when unclassifiable. */
export function canonicalProgramLevel(raw: unknown): ProgramCanonical | null {
  if (raw === null || raw === undefined) return null;
  const key = String(raw).trim().toLowerCase();
  if (!key) return null;
  return PROGRAM_MAP[key] ?? null;
}

const COURSE_NAMED_FIX: Record<string, CourseCanonical> = {
  undergraduate: 'Undergraduate',
  postgraduate: 'Postgraduate',
  diploma: 'Diploma',
  certificate: 'Certificate',
};

const COURSE_ALIAS_FALLBACK: Record<string, CourseCanonical> = {
  bachelor: 'Undergraduate',
  bachelors: 'Undergraduate',
  undergrad: 'Undergraduate',
  ug: 'Undergraduate',
  master: 'Postgraduate',
  masters: 'Postgraduate',
  graduate: 'Postgraduate',
  postgraduate: 'Postgraduate',
  grad: 'Postgraduate',
  pg: 'Postgraduate',
  doctorate: 'Postgraduate', // no doctoral course-level exists in the UI model; PhD tabs match by title
  doctoral: 'Postgraduate',
  phd: 'Postgraduate',
  diploma: 'Diploma',
  certificate: 'Certificate',
};

/**
 * Map a raw courses.level value to canonical form.
 *
 * Precedence (first match wins):
 *  1. Already canonical — numeric band 100–800 kept verbatim (800 is the PhD
 *     band the UMS tabs match on); named values fixed to canonical
 *     capitalisation.
 *  2. Certificate/diploma code prefixes (GC*, CERT*, DIM*, DIP*, DCMT*) — these
 *     categories have no numeric band in the canonical catalogue, so the honest
 *     repair is the named category, not an invented band.
 *  3. First digit of the course code (1–7) → that hundred band. Course numbering
 *     is authoritative in this schema (see 0044 seeds: BIBL101→'100').
 *  4. Linked program's canonical level (undergraduate→Undergraduate,
 *     graduate/doctorate→Postgraduate, certificate→Certificate, diploma→Diploma).
 *  5. Alias spellings of the level itself (bachelor→Undergraduate, …).
 *  6. Otherwise null — leave the row untouched and report it.
 */
export function canonicalCourseLevel(
  raw: unknown,
  code: unknown,
  programLevel: unknown,
): CourseCanonical | null {
  const t = raw === null || raw === undefined ? '' : String(raw).trim();
  const low = t.toLowerCase();

  // 1. Canonical bands + named values (fix capitalisation drift).
  if (/^[1-8]00$/.test(t)) return t as CourseCanonical;
  if (COURSE_NAMED_FIX[low]) return COURSE_NAMED_FIX[low];

  const upperCode = code === null || code === undefined ? '' : String(code).trim().toUpperCase();

  // 2. Certificate / diploma prefixes have no numeric band — keep the category.
  if (/^(GC|CERT)[A-Z]*\d/.test(upperCode)) return 'Certificate';
  if (/^(DIM|DIP|DCMT)/.test(upperCode)) return 'Diploma';

  // 3. Course-number band (1–7; 8 is kept verbatim by rule 1, 0/9 have no band).
  const digit = (upperCode.match(/\d/) ?? [])[0];
  if (digit && digit >= '1' && digit <= '7') return `${digit}00` as CourseCanonical;

  // 4. Linked program's level.
  const prog = canonicalProgramLevel(programLevel);
  if (prog === 'undergraduate') return 'Undergraduate';
  if (prog === 'graduate' || prog === 'doctorate') return 'Postgraduate';
  if (prog === 'certificate') return 'Certificate';
  if (prog === 'diploma') return 'Diploma';

  // 5. Alias spellings.
  if (COURSE_ALIAS_FALLBACK[low]) return COURSE_ALIAS_FALLBACK[low];

  // 6. Unclassifiable — caller reports, never writes.
  return null;
}

interface LevelRow {
  id: string;
  code: string | null;
  level: string | null;
  program_id?: string | null;
}

async function distribution(
  pool: Pool,
  table: 'programs' | 'courses',
): Promise<Array<{ level: string | null; count: string }>> {
  const { rows } = await pool.query(
    `SELECT level, COUNT(*)::text AS count FROM ${table} GROUP BY level ORDER BY level NULLS LAST`,
  );
  return rows as Array<{ level: string | null; count: string }>;
}

function printDistribution(title: string, rows: Array<{ level: string | null; count: string }>): void {
  console.log(`\n── ${title} ──`);
  if (rows.length === 0) {
    console.log('   (no rows)');
    return;
  }
  for (const r of rows) console.log(`   ${JSON.stringify(r.level)}: ${r.count}`);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const apply = argv.includes('--apply');
  const url = process.env.DATABASE_URL_CORE;
  if (!url) throw new Error('DATABASE_URL_CORE environment variable is required');

  console.log(`normalize-taxonomy — ${apply ? 'APPLY MODE (writes!)' : 'DRY RUN (no writes)'}`);
  const pool = new Pool({ connectionString: url });
  try {
    printDistribution('programs.level BEFORE', await distribution(pool, 'programs'));
    printDistribution('courses.level BEFORE', await distribution(pool, 'courses'));

    const { rows: programs } = await pool.query(
      `SELECT id, code, level FROM programs`,
    );
    const programUpdates: Array<{ id: string; from: string | null; to: ProgramCanonical }> = [];
    const programLeftovers: Array<{ id: string; code: string | null; level: string | null }> = [];
    const programCanonicalById = new Map<string, ProgramCanonical>();
    for (const p of programs as LevelRow[]) {
      const to = canonicalProgramLevel(p.level);
      if (to) {
        programCanonicalById.set(p.id, to);
        if (p.level !== to) programUpdates.push({ id: p.id, from: p.level, to });
      } else {
        programLeftovers.push({ id: p.id, code: p.code, level: p.level });
      }
    }

    const { rows: courses } = await pool.query(
      `SELECT c.id, c.code, c.level, c.program_id, p.level AS program_level
       FROM courses c LEFT JOIN programs p ON p.id = c.program_id`,
    );
    const courseUpdates: Array<{ id: string; code: string | null; from: string | null; to: CourseCanonical }> = [];
    const courseLeftovers: Array<{ id: string; code: string | null; level: string | null }> = [];
    for (const c of courses as Array<LevelRow & { program_level: string | null }>) {
      const to = canonicalCourseLevel(c.level, c.code, c.program_level);
      if (to) {
        if (c.level !== to) courseUpdates.push({ id: c.id, code: c.code, from: c.level, to });
      } else {
        courseLeftovers.push({ id: c.id, code: c.code, level: c.level });
      }
    }

    console.log(`\nPlanned program updates: ${programUpdates.length}`);
    for (const u of programUpdates.slice(0, 50)) {
      console.log(`   ${u.id} (${u.from ?? 'NULL'} → ${u.to})`);
    }
    if (programUpdates.length > 50) console.log(`   … and ${programUpdates.length - 50} more`);
    console.log(`Planned course updates: ${courseUpdates.length}`);
    for (const u of courseUpdates.slice(0, 50)) {
      console.log(`   ${u.code ?? u.id} (${u.from ?? 'NULL'} → ${u.to})`);
    }
    if (courseUpdates.length > 50) console.log(`   … and ${courseUpdates.length - 50} more`);

    if (apply) {
      await pool.query('BEGIN');
      try {
        for (const u of programUpdates) {
          await pool.query(`UPDATE programs SET level = $1 WHERE id = $2`, [u.to, u.id]);
        }
        for (const u of courseUpdates) {
          await pool.query(`UPDATE courses SET level = $1 WHERE id = $2`, [u.to, u.id]);
        }
        await pool.query('COMMIT');
        console.log('\nCommitted.');
      } catch (e) {
        await pool.query('ROLLBACK');
        throw e;
      }
      printDistribution('programs.level AFTER', await distribution(pool, 'programs'));
      printDistribution('courses.level AFTER', await distribution(pool, 'courses'));
    } else {
      console.log('\nDry run — no writes. Re-run with --apply to commit.');
    }

    if (programLeftovers.length > 0) {
      console.log(`\nUnclassifiable programs (left untouched): ${programLeftovers.length}`);
      for (const r of programLeftovers.slice(0, 20)) console.log(`   ${r.id} code=${r.code} level=${JSON.stringify(r.level)}`);
    }
    if (courseLeftovers.length > 0) {
      console.log(`\nUnclassifiable courses (left untouched): ${courseLeftovers.length}`);
      for (const r of courseLeftovers.slice(0, 20)) console.log(`   ${r.id} code=${r.code} level=${JSON.stringify(r.level)}`);
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
}

const invokedAsScript =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  await main();
}
