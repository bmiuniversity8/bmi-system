import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = dirname(fileURLToPath(import.meta.url));

function columns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table) as any[]).map((r) => r.name as string);
}

describe('D1 migrations replay (Tasks 01-08)', () => {
  it('replays ALL migrations on an empty SQLite DB with no errors', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY);`);
    const dir = join(here, 'migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    expect(files.length).toBeGreaterThanOrEqual(48);
    // Compare against the highest migration number present instead of a
    // hardcoded prefix, so adding 0049+ does not break the test.
    const maxNum = Math.max(...files.map((f) => Number(f.slice(0, 4))));
    expect(files[files.length - 1]).toMatch(new RegExp(`^${String(maxNum).padStart(4, '0')}_`));
    for (const f of files) {
      const sql = readFileSync(join(dir, f), 'utf8');
      try {
        db.exec(sql);
      } catch (e: unknown) {
        throw new Error(`Migration ${f} failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
      }
    }

    // Every table/column the fixed code reads or writes must exist.
    const apps = columns(db, 'applications');
    for (const c of ['id', 'user_id', 'program', 'program_id', 'degree_level', 'status', 'application_number', 'possible_duplicate_of', 'high_school', 'graduation_year', 'gpa']) {
      expect(apps, 'applications').toContain(c);
    }
    const statusCheck = db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'applications'`).get() as any;
    expect(statusCheck.sql).toContain('withdrawn');

    const terms = columns(db, 'academic_terms');
    for (const c of ['registration_opens_at', 'registration_closes_at', 'census_date']) {
      expect(terms, 'academic_terms').toContain(c);
    }
    expect(columns(db, 'invoices')).toContain('term_id');
    expect(columns(db, 'esignatures')).toContain('term_id');

    const depIdx = db.prepare(`SELECT name, sql FROM sqlite_master WHERE name LIKE '%enrollment_deposits%payment%'`).all() as any[];
    expect(depIdx.length).toBeGreaterThanOrEqual(1);
    expect(depIdx[0].sql).toMatch(/UNIQUE/i);

    const cfg = db.prepare(`SELECT value FROM app_config WHERE key = 'max_credits_per_term'`).get() as any;
    expect(cfg?.value).toBe('18');

    // 0049: completion writer support — wider status CHECK + completed_at.
    const scr = columns(db, 'student_course_registrations');
    expect(scr).toContain('completed_at');
    const scrCheck = db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'student_course_registrations'`).get() as any;
    expect(scrCheck.sql).toContain('waitlisted');
    expect(scrCheck.sql).toContain('completed');

    // Fixture preservation: withdrawn row survives the rebuild.
    db.exec(`INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_verified) VALUES ('u-1','a@b.c','h','A','B','applicant',1);`);
    db.exec(`INSERT INTO applications (id, user_id, program, degree_level, status) VALUES ('app-1','u-1','Theology','undergraduate','withdrawn');`);
    const row = db.prepare(`SELECT status FROM applications WHERE id = 'app-1'`).get() as any;
    expect(row.status).toBe('withdrawn');
  });
});
