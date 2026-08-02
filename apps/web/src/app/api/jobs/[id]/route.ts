import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { jobs } from '@editz/db';
import { getPlatform } from '@/server/platform';

export const runtime = 'nodejs';

/** Current state, for a client that reconnected or never opened the stream. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { db } = await getPlatform();

  const [job] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  if (!job) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    outputBytes: job.outputBytes,
    expiresAt: job.expiresAt?.toISOString() ?? null,
  });
}

/**
 * "Delete now", from the download screen (§2.4).
 *
 * The bucket lifecycle rule is what guarantees the 24-hour promise. This is
 * for the person who has their file and would rather not wait a day for the
 * copy on our disk to go — which is a reasonable thing to want and costs us
 * nothing to honour.
 *
 * The row survives with its keys cleared: usage and analytics should not be
 * rewritten by someone tidying up after themselves.
 */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { db, storage, progress } = await getPlatform();

  const [job] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  if (!job) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  await Promise.all(
    [job.inputKey, job.outputKey]
      .filter((key): key is string => typeof key === 'string')
      .map((key) => storage.delete(key)),
  );

  await db
    .update(jobs)
    .set({ inputKey: null, outputKey: null, expiresAt: null, filesDeletedAt: new Date() })
    .where(eq(jobs.id, id));
  await progress.clear(id);

  return NextResponse.json({ deleted: true });
}
