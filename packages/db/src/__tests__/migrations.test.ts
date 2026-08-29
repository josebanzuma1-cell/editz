import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../migrations.generated';

/**
 * Guards the one piece of duplication in this package.
 *
 * `migrations.generated.ts` exists because a bundler cannot read a sibling
 * directory at runtime. That makes it a second copy of the SQL, and a second
 * copy that can drift is worse than the problem it solved — so this fails the
 * moment it does. Same arrangement as `slugs.ts` in the registry.
 */
const migrationsDir = fileURLToPath(new URL('../../migrations/', import.meta.url));

describe('bundled migrations', () => {
  it('matches the journal, in order', async () => {
    const journal = JSON.parse(
      await readFile(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: { tag: string }[] };

    expect(MIGRATIONS.map((m) => m.tag)).toEqual(journal.entries.map((e) => e.tag));
  });

  it('matches the SQL on disk, statement for statement', async () => {
    for (const migration of MIGRATIONS) {
      const sql = await readFile(join(migrationsDir, `${migration.tag}.sql`), 'utf8');
      const expected = sql
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean);

      expect(migration.statements, `${migration.tag} is stale — run pnpm --filter @editz/db generate`)
        .toEqual(expected);
    }
  });

  it('covers every .sql file in the directory', async () => {
    // A migration generated but never bundled would silently not be applied
    // in development, so the dev database would quietly differ from production.
    const onDisk = (await readdir(migrationsDir))
      .filter((name) => name.endsWith('.sql'))
      .map((name) => name.replace(/\.sql$/, ''))
      .sort();

    expect([...MIGRATIONS.map((m) => m.tag)].sort()).toEqual(onDisk);
  });

  it('has something to apply', () => {
    expect(MIGRATIONS.length).toBeGreaterThan(0);
    expect(MIGRATIONS[0]?.statements.length).toBeGreaterThan(0);
  });
});
