import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

describe('create-admin credential guard (Task 09)', () => {
  it('create-admin.sql contains no committed credential (hash literal or INSERT)', () => {
    const sql = readFileSync(join(here, 'create-admin.sql'), 'utf8');
    // Bcrypt-style hash literals must never be committed.
    expect(sql).not.toMatch(/\$2[aby]\$/);
    // No seed INSERT with a credential value.
    expect(sql).not.toMatch(/INSERT\s+INTO\s+users/i);
  });

  it('no committed SQL file contains a bcrypt hash literal', () => {
    const dirs = [here, join(here, 'migrations')];
    for (const dir of dirs) {
      const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
      for (const f of files) {
        const sql = readFileSync(join(dir, f), 'utf8');
        expect(sql, f).not.toMatch(/\$2[aby]\$\d+\$/);
      }
    }
  });
});
