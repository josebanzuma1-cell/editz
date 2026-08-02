import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { jobs } from '@editz/db';
import { getPlatform } from '@/server/platform';

export const runtime = 'nodejs';

/**
 * Step 7 of §7: a presigned GET, valid for an hour.
 *
 * A redirect rather than a proxy. Streaming the file back through this
 * function would put every downloaded byte through a serverless invocation
 * and, worse, through a second network hop — the reason for R2 is that the
 * bytes go straight from the bucket to the user, and free egress does not
 * help if we insist on handling them.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { db, storage } = await getPlatform();

  const [job] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  if (!job) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  if (job.status !== 'done' || !job.outputKey) {
    return NextResponse.json({ error: 'not-ready', status: job.status }, { status: 409 });
  }

  // Expiry is a promise, not a formality (§11): once the file is gone, say so
  // plainly rather than handing out a URL that 404s at the bucket.
  if (job.filesDeletedAt || (job.expiresAt && job.expiresAt.getTime() < Date.now())) {
    return NextResponse.json({ error: 'expired' }, { status: 410 });
  }

  const { url } = await storage.presignGet(job.outputKey, { expiresInSeconds: 3600 });
  return NextResponse.redirect(url, 302);
}
