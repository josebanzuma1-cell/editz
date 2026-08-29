import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { jobs } from '@editz/db';
import { detect, isAcceptable, HEAD_BYTES } from '@editz/engine-server';
import { getTool } from '@editz/tool-registry';
import { getPlatform } from '@/server/platform';

export const runtime = 'nodejs';

/**
 * Step 3 of §7: the upload has landed, so queue the work.
 *
 * This is the first moment the file is ours to inspect, and the last cheap
 * moment to reject it. Two checks happen before anything is enqueued:
 *
 *   - the object actually exists and is the size that was reserved, because
 *     the presigned URL was handed out before any bytes were sent;
 *   - the *bytes* say what the file is (§11). The client's declared MIME came
 *     from a file extension and is trivially wrong and trivially lied about.
 *     Reading 16 bytes here costs nothing; discovering it in the worker costs
 *     a download and a scheduling slot.
 */
export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { db, storage, queue } = await getPlatform();

  const [job] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  if (!job) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  if (job.executionMode !== 'server' || !job.inputKey) {
    return NextResponse.json({ error: 'not-a-server-job' }, { status: 400 });
  }
  // Idempotent: a retried start must not enqueue the work twice.
  if (job.status !== 'queued') {
    return NextResponse.json({ jobId: job.id, status: job.status });
  }

  const head = await storage.head(job.inputKey);
  if (!head) return NextResponse.json({ error: 'nothing-uploaded' }, { status: 409 });
  if (head.bytes > job.inputBytes) {
    await fail(db, job.id, 'upload-larger-than-declared');
    return NextResponse.json({ error: 'upload-larger-than-declared' }, { status: 413 });
  }

  const tool = getTool(job.toolSlug);
  if (!tool) return NextResponse.json({ error: 'unknown-tool' }, { status: 404 });

  const detected = detect(await storage.readHead(job.inputKey, HEAD_BYTES));
  if (!isAcceptable(detected, tool.kind === 'audio' ? 'audio' : tool.kind === 'image' ? 'image' : 'video')) {
    await fail(db, job.id, 'unrecognised-file');
    // The object is useless to us and we promised not to keep things.
    await storage.delete(job.inputKey);
    return NextResponse.json({ error: 'unrecognised-file' }, { status: 415 });
  }

  await queue.enqueue({
    jobId: job.id,
    toolSlug: job.toolSlug,
    inputKeys: [job.inputKey],
    params: job.params,
    inputBytes: job.inputBytes,
  });

  return NextResponse.json({ jobId: job.id, status: 'queued' });
}

async function fail(
  db: Awaited<ReturnType<typeof getPlatform>>['db'],
  id: string,
  error: string,
): Promise<void> {
  await db
    .update(jobs)
    .set({ status: 'failed', error, finishedAt: new Date() })
    .where(eq(jobs.id, id));
}
