import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getTool } from '@editz/tool-registry';
import { jobs, RETENTION_HOURS } from '@editz/db';
import { inputKey } from '@editz/storage';
import { getPlatform } from '@/server/platform';
import { anonFingerprint } from '@/server/identity';
import { checkQuota } from '@/server/quota';

export const runtime = 'nodejs';

/**
 * Step 1 of §7: reserve a job and hand back a URL to upload to.
 *
 * The response is a presigned PUT, not an upload endpoint. Bytes never pass
 * through this API — a 2GB upload through a serverless function is billed by
 * the second and capped by the platform, and the whole point of R2 is that the
 * transfer happens between the browser and the bucket.
 */
const body = z.object({
  toolSlug: z.string().min(1),
  params: z.unknown(),
  files: z
    .array(
      z.object({
        name: z.string().min(1).max(400),
        bytes: z.number().int().positive(),
        mime: z.string().max(200),
      }),
    )
    .min(1)
    .max(20),
});

export async function POST(request: NextRequest) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const tool = getTool(parsed.data.toolSlug);
  if (!tool) return NextResponse.json({ error: 'unknown-tool' }, { status: 404 });

  // Re-validated here even though the client already did it. The client's
  // check is for the user's benefit; this one exists because the client is
  // not trusted (§7).
  const params = tool.params.safeParse(parsed.data.params);
  if (!params.success) {
    return NextResponse.json({ error: 'invalid-params' }, { status: 400 });
  }

  if (!tool.multiFile && parsed.data.files.length > 1) {
    return NextResponse.json({ error: 'too-many-files' }, { status: 400 });
  }

  const totalBytes = parsed.data.files.reduce((sum, file) => sum + file.bytes, 0);
  const { db, storage } = await getPlatform();

  // Accounts arrive in M4, so every job is anonymous for now.
  const fingerprint = anonFingerprint(request);
  const denial = await checkQuota(db, {
    plan: 'free',
    bytes: totalBytes,
    toolIsPro: tool.category === 'ai',
    anonFingerprint: fingerprint,
  });
  if (denial) return NextResponse.json({ error: denial }, { status: 413 });

  // The id is chosen here rather than by the default, so the storage keys can
  // be built before the insert instead of patched in afterwards.
  const jobId = randomUUID();
  const keys = parsed.data.files.map((file) => inputKey(jobId, file.name));

  await db.insert(jobs).values({
    id: jobId,
    toolSlug: tool.slug,
    executionMode: 'server',
    anonFingerprint: fingerprint,
    inputBytes: totalBytes,
    params: params.data,
    inputKey: keys[0]!,
    expiresAt: new Date(Date.now() + RETENTION_HOURS * 3600 * 1000),
  });

  const uploads = await Promise.all(
    parsed.data.files.map(async (file, index) =>
      storage.presignPut(keys[index]!, {
        contentType: file.mime,
        // Signed into the URL, so it is a limit rather than a suggestion.
        maxBytes: file.bytes,
        expiresInSeconds: 900,
      }),
    ),
  );

  return NextResponse.json({
    jobId,
    uploads: uploads.map((upload, index) => ({
      key: keys[index]!,
      url: upload.url,
      headers: upload.headers,
      expiresAt: upload.expiresAt.toISOString(),
    })),
  });
}
