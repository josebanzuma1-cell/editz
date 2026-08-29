import { and, eq, isNotNull, isNull, lt } from 'drizzle-orm';
import { jobs, type Database } from '@editz/db';
import type { Storage } from '@editz/storage';

/**
 * Makes the 24-hour promise true rather than aspirational.
 *
 * The bucket lifecycle rule is the real guarantee — it runs even if every
 * process we own is down, which is exactly the situation in which a promise
 * about deleting people's video should still hold. This sweeper exists
 * because a lifecycle rule works on a schedule of the provider's choosing and
 * says nothing to our own database, so without it `jobs` would keep pointing
 * at objects that no longer exist and the UI would offer downloads that 404.
 *
 * Deliberately best-effort per row: one object that will not delete must not
 * stop the other nine hundred from being swept.
 */
export interface SweepResult {
  examined: number;
  deleted: number;
  failed: number;
}

export async function sweepExpired(
  db: Database,
  storage: Storage,
  options: { limit?: number; now?: Date } = {},
): Promise<SweepResult> {
  const now = options.now ?? new Date();

  const expired = await db
    .select({ id: jobs.id, inputKey: jobs.inputKey, outputKey: jobs.outputKey })
    .from(jobs)
    .where(
      and(
        isNotNull(jobs.expiresAt),
        lt(jobs.expiresAt, now),
        // Already swept rows are skipped rather than re-deleted every run.
        isNull(jobs.filesDeletedAt),
      ),
    )
    .limit(options.limit ?? 500);

  let deleted = 0;
  let failed = 0;

  for (const job of expired) {
    const keys = [job.inputKey, job.outputKey].filter(
      (key): key is string => typeof key === 'string',
    );

    try {
      for (const key of keys) await storage.delete(key);
      // The row survives, with its keys cleared. Usage history should not be
      // rewritten by the passage of time.
      await db
        .update(jobs)
        .set({ inputKey: null, outputKey: null, filesDeletedAt: now })
        .where(eq(jobs.id, job.id));
      deleted++;
    } catch {
      // Left for the next run. A storage blip should not lose the record that
      // there is still something to delete.
      failed++;
    }
  }

  return { examined: expired.length, deleted, failed };
}
