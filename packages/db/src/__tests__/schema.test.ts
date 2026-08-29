import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq, gte, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { jobs, schema, usage, users } from '../schema';

/**
 * These run against real Postgres.
 *
 * PGlite is Postgres itself compiled to wasm, in-process — so the check
 * constraints, the enums and the indexes are genuinely exercised rather than
 * typechecked and hoped about. A schema test that only proves Drizzle's
 * TypeScript agrees with itself would not catch the one thing most worth
 * catching: an invariant that the database does not actually enforce.
 */

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;


/**
 * The schema under test is the *generated migration*, not a hand-copy of it.
 *
 * Applying separate hand-written DDL would let these tests pass while the
 * migration that actually ships is wrong — which is the one failure a schema
 * test exists to prevent.
 */
async function applySchema(pg: PGlite): Promise<void> {
  const dir = fileURLToPath(new URL('../../migrations/', import.meta.url));
  const journal = JSON.parse(
    await readFile(join(dir, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };

  for (const entry of journal.entries) {
    const migration = await readFile(join(dir, `${entry.tag}.sql`), 'utf8');
    for (const statement of migration.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) await pg.exec(trimmed);
    }
  }
}

beforeAll(async () => {
  client = new PGlite();
  await applySchema(client);
  db = drizzle(client, { schema });
}, 60_000);

afterAll(async () => {
  await client?.close();
});

beforeEach(async () => {
  await client.exec('TRUNCATE jobs, usage, users CASCADE;');
});

/**
 * Names the constraint that rejected a write.
 *
 * Drizzle wraps the driver error in a "Failed query: …" message, so matching
 * on `.message` proves only that *something* went wrong. The constraint name
 * lives on the cause, and asserting on it is the difference between "the
 * insert failed" and "the insert failed for the reason we designed".
 */
async function violatedConstraint(write: () => Promise<unknown>): Promise<string> {
  try {
    await write();
  } catch (error) {
    const cause = (error as { cause?: { constraint_name?: string; constraint?: string } }).cause;
    const name = cause?.constraint_name ?? cause?.constraint;
    if (name) return name;
    throw new Error(`rejected, but no constraint name on the cause: ${String(error)}`);
  }
  throw new Error('expected this write to be rejected, but it succeeded');
}

const baseJob = {
  toolSlug: 'compress-video',
  inputBytes: 40 * 1024 * 1024,
  params: { quality: 'balanced' },
  anonFingerprint: 'fp-abc',
};

describe('jobs', () => {
  it('records a client-side job with no input key', async () => {
    // The point of the row: nothing was uploaded, but quota and analytics
    // still see the work.
    const [row] = await db
      .insert(jobs)
      .values({ ...baseJob, executionMode: 'client' })
      .returning();

    expect(row?.inputKey).toBeNull();
    expect(row?.status).toBe('queued');
    expect(row?.progress).toBe(0);
  });

  it('refuses a client job that claims an uploaded file', async () => {
    // If this ever passes, "nothing was uploaded" has stopped being true and
    // the meter has started lying.
    expect(
      await violatedConstraint(() =>
        db.insert(jobs).values({
          ...baseJob,
          executionMode: 'client',
          inputKey: 'uploads/should-not-exist',
        }),
      ),
    ).toBe('jobs_client_has_no_input_key');
  });

  it('refuses a server job with nothing to fetch', async () => {
    expect(
      await violatedConstraint(() =>
        db.insert(jobs).values({ ...baseJob, executionMode: 'server' }),
      ),
    ).toBe('jobs_client_has_no_input_key');
  });

  it('accepts a server job that has its key', async () => {
    const [row] = await db
      .insert(jobs)
      .values({ ...baseJob, executionMode: 'server', inputKey: 'uploads/abc.mp4' })
      .returning();
    expect(row?.inputKey).toBe('uploads/abc.mp4');
  });

  it('refuses a job nobody can be billed or rate-limited for', async () => {
    expect(
      await violatedConstraint(() =>
        db.insert(jobs).values({
          toolSlug: 'compress-video',
          inputBytes: 1,
          params: {},
          executionMode: 'client',
        }),
      ),
    ).toBe('jobs_has_an_owner');
  });

  it('keeps progress inside 0..1', async () => {
    expect(
      await violatedConstraint(() =>
        db.insert(jobs).values({ ...baseJob, executionMode: 'client', progress: 1.5 }),
      ),
    ).toBe('jobs_progress_range');
  });

  it('survives its user being deleted, so usage history is not rewritten', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: 'someone@example.com' })
      .returning();

    await db.insert(jobs).values({ ...baseJob, executionMode: 'client', userId: user!.id });
    await db.delete(users).where(eq(users.id, user!.id));

    const remaining = await db.select().from(jobs);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.userId).toBeNull();
  });

  it('finds what the sweeper has to delete', async () => {
    // §11: nothing is retained past 24 hours, and this is the query that
    // makes that true rather than aspirational.
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 3_600_000);

    await db.insert(jobs).values([
      { ...baseJob, executionMode: 'server', inputKey: 'a', expiresAt: past },
      { ...baseJob, executionMode: 'server', inputKey: 'b', expiresAt: future },
      { ...baseJob, executionMode: 'client' },
    ]);

    const expired = await db
      .select()
      .from(jobs)
      .where(sql`${jobs.expiresAt} IS NOT NULL AND ${jobs.expiresAt} < now()`);

    expect(expired).toHaveLength(1);
    expect(expired[0]?.inputKey).toBe('a');
  });

  it('stores params as JSON that comes back as an object', async () => {
    const params = { mode: 'size', targetSizeMb: 25, nested: { keepAudio: true } };
    const [row] = await db
      .insert(jobs)
      .values({ ...baseJob, executionMode: 'client', params })
      .returning();
    expect(row?.params).toEqual(params);
  });
});

describe('usage', () => {
  it('totals a day of anonymous work, which is what the quota reads', async () => {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);

    await db.insert(usage).values([
      { anonFingerprint: 'fp-1', toolSlug: 'compress-video', executionMode: 'client', bytesProcessed: 10 },
      { anonFingerprint: 'fp-1', toolSlug: 'cut-video', executionMode: 'client', bytesProcessed: 32 },
      { anonFingerprint: 'fp-2', toolSlug: 'compress-video', executionMode: 'client', bytesProcessed: 99 },
    ]);

    const [total] = await db
      .select({ bytes: sql<number>`coalesce(sum(${usage.bytesProcessed}), 0)::bigint` })
      .from(usage)
      .where(and(eq(usage.anonFingerprint, 'fp-1'), gte(usage.executedAt, midnight)));

    expect(Number(total?.bytes)).toBe(42);
  });

  it('counts client work too, so the free path is not invisible', async () => {
    await db.insert(usage).values({
      anonFingerprint: 'fp-1',
      toolSlug: 'resize-image',
      executionMode: 'client',
      bytesProcessed: 5,
    });
    const rows = await db.select().from(usage).where(eq(usage.executionMode, 'client'));
    expect(rows).toHaveLength(1);
  });
});

describe('users', () => {
  it('will not take the same email twice', async () => {
    await db.insert(users).values({ email: 'dup@example.com' });
    expect(
      await violatedConstraint(() => db.insert(users).values({ email: 'dup@example.com' })),
    ).toBe('users_email_idx');
  });

  it('starts everyone on the free plan', async () => {
    const [row] = await db.insert(users).values({ email: 'new@example.com' }).returning();
    expect(row?.plan).toBe('free');
    expect(row?.planExpiresAt).toBeNull();
  });
});
