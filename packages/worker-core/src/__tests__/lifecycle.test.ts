import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { jobs, schema, type Database } from '@editz/db';
import { MemoryProgressStore, MemoryQueue } from '@editz/queue';
import { LocalStorage, inputKey } from '@editz/storage';
import { handle, sweepExpired } from '../index';

/**
 * The §7 lifecycle, end to end, with nothing installed.
 *
 * Real Postgres (PGlite), real object storage (disk), a real queue, and a
 * real FFmpeg. The only thing standing in for production is *which*
 * implementation is behind each interface — which is exactly the substitution
 * the interfaces exist to make safe.
 *
 * Without this, the server path is first exercised by a user.
 */

function findFfmpeg(): string | null {
  for (const candidate of [process.env.FFMPEG_PATH, 'ffmpeg']) {
    if (!candidate) continue;
    try {
      execFileSync(candidate, ['-version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      /* next */
    }
  }
  return null;
}

const FFMPEG = findFfmpeg();
const root = mkdtempSync(join(tmpdir(), 'editz-lifecycle-'));

let client: PGlite;
let db: Database;
let storage: LocalStorage;
let progress: MemoryProgressStore;
let queue: MemoryQueue;

beforeAll(async () => {
  client = new PGlite();
  // fileURLToPath, not `.pathname` — on Windows the pathname is `/C:/...` and
  // stripping the leading slash happens to work, but on Linux it turns an
  // absolute path into a relative one and every read fails. CI is Linux.
  const dir = fileURLToPath(new URL('../../../db/migrations/', import.meta.url));
  const journal = JSON.parse(
    await readFile(join(dir, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  for (const entry of journal.entries) {
    const sqlText = await readFile(join(dir, `${entry.tag}.sql`), 'utf8');
    for (const statement of sqlText.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) await client.exec(trimmed);
    }
  }
  db = drizzle(client, { schema }) as unknown as Database;
  storage = new LocalStorage({
    root: join(root, 'storage'),
    secret: 'lifecycle-test',
    publicOrigin: 'http://localhost:3000',
  });
  progress = new MemoryProgressStore();
  queue = new MemoryQueue({ backoffMs: 5 });
}, 120_000);

afterAll(async () => {
  await queue?.close();
  await client?.close();
  rmSync(root, { recursive: true, force: true });
});

beforeEach(async () => {
  await client.exec('TRUNCATE jobs, usage, users CASCADE;');
});

async function seedJob(id: string, overrides: Record<string, unknown> = {}) {
  const key = inputKey(id, 'sample.mp4');
  if (FFMPEG) {
    const local = join(root, `${id}.mp4`);
    execFileSync(FFMPEG, [
      '-hide_banner', '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=15:duration=2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', local,
    ]);
    await storage.uploadFrom(key, local, 'video/mp4');
  }

  await db.insert(jobs).values({
    id,
    toolSlug: 'compress-video',
    executionMode: 'server',
    anonFingerprint: 'fp-test',
    inputBytes: 1000,
    params: {
      mode: 'quality',
      quality: 'small',
      resolution: 'original',
      codec: 'h264',
      keepAudio: false,
    },
    inputKey: key,
    expiresAt: new Date(Date.now() + 3600_000),
    ...overrides,
  });

  return key;
}

const context = () => ({
  attempt: 1,
  signal: new AbortController().signal,
  reportProgress: async () => {},
});

describe.skipIf(FFMPEG === null)('the whole job lifecycle', () => {
  it('takes a queued job to done, with an output the user can fetch', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const key = await seedJob(id);

    await handle(
      { jobId: id, toolSlug: 'compress-video', inputKeys: [key], params: {}, inputBytes: 1000 },
      context(),
      { db, storage, queue, progress, ffmpegPath: FFMPEG! },
    );

    const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
    expect(row?.status).toBe('done');
    expect(row?.progress).toBe(1);
    expect(row?.outputKey).toBeTruthy();
    expect(row?.outputBytes).toBeGreaterThan(0);
    expect(row?.finishedAt).toBeTruthy();

    // The artefact is really there and really fetchable.
    const head = await storage.head(row!.outputKey!);
    expect(head?.bytes).toBe(row?.outputBytes);
  }, 120_000);

  it('deletes the input once the output exists', async () => {
    // Half of what is held, and the half nobody will ever ask for.
    const id = '22222222-2222-4222-8222-222222222222';
    const key = await seedJob(id);

    await handle(
      { jobId: id, toolSlug: 'compress-video', inputKeys: [key], params: {}, inputBytes: 1000 },
      context(),
      { db, storage, queue, progress, ffmpegPath: FFMPEG! },
    );

    expect(await storage.head(key)).toBeNull();
  }, 120_000);

  it('publishes progress that ends at 1', async () => {
    const id = '33333333-3333-4333-8333-333333333333';
    const key = await seedJob(id);

    await handle(
      { jobId: id, toolSlug: 'compress-video', inputKeys: [key], params: {}, inputBytes: 1000 },
      context(),
      { db, storage, queue, progress, ffmpegPath: FFMPEG! },
    );

    expect(await progress.get(id)).toBe(1);
  }, 120_000);

  it('records a readable code on failure, never FFmpeg stderr', async () => {
    // §7: "Invalid data found when processing input" tells a developer the
    // file is corrupt and tells everyone else nothing.
    const id = '44444444-4444-4444-8444-444444444444';
    const key = inputKey(id, 'broken.mp4');
    await storage.put(key, new TextEncoder().encode('this is not a video'), 'video/mp4');
    await seedJob(id, { inputKey: key });

    await expect(
      handle(
        { jobId: id, toolSlug: 'compress-video', inputKeys: [key], params: {}, inputBytes: 10 },
        context(),
        { db, storage, queue, progress, ffmpegPath: FFMPEG! },
      ),
    ).rejects.toBeDefined();

    const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
    expect(row?.status).toBe('failed');
    expect(row?.error).toBeTruthy();
    expect(row?.error).not.toMatch(/ffmpeg|stderr|Invalid data/i);
  }, 120_000);
});

describe('the sweeper', () => {
  it('deletes expired objects and clears the keys, keeping the row', async () => {
    const id = '55555555-5555-4555-8555-555555555555';
    const key = inputKey(id, 'old.mp4');
    await storage.put(key, new Uint8Array([1, 2, 3]));
    await db.insert(jobs).values({
      id,
      toolSlug: 'compress-video',
      executionMode: 'server',
      anonFingerprint: 'fp-test',
      inputBytes: 3,
      params: {},
      inputKey: key,
      expiresAt: new Date(Date.now() - 1000),
    });

    const result = await sweepExpired(db, storage);

    expect(result).toMatchObject({ examined: 1, deleted: 1, failed: 0 });
    expect(await storage.head(key)).toBeNull();

    const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
    // The row survives: usage history is not rewritten by the passage of time.
    expect(row).toBeDefined();
    expect(row?.inputKey).toBeNull();
    expect(row?.filesDeletedAt).toBeTruthy();
    // ...and it is still recorded as the server job it was.
    expect(row?.executionMode).toBe('server');
  });

  it('leaves jobs that have not expired alone', async () => {
    const id = '66666666-6666-4666-8666-666666666666';
    const key = inputKey(id, 'fresh.mp4');
    await storage.put(key, new Uint8Array([1]));
    await db.insert(jobs).values({
      id,
      toolSlug: 'compress-video',
      executionMode: 'server',
      anonFingerprint: 'fp-test',
      inputBytes: 1,
      params: {},
      inputKey: key,
      expiresAt: new Date(Date.now() + 3600_000),
    });

    expect(await sweepExpired(db, storage)).toMatchObject({ examined: 0, deleted: 0 });
    expect(await storage.head(key)).not.toBeNull();
  });

  it('does not sweep the same row twice', async () => {
    const id = '77777777-7777-4777-8777-777777777777';
    await db.insert(jobs).values({
      id,
      toolSlug: 'compress-video',
      executionMode: 'server',
      anonFingerprint: 'fp-test',
      inputBytes: 1,
      params: {},
      inputKey: inputKey(id, 'gone.mp4'),
      expiresAt: new Date(Date.now() - 1000),
    });

    await sweepExpired(db, storage);
    expect(await sweepExpired(db, storage)).toMatchObject({ examined: 0 });
  });

  it('ignores client jobs, which have nothing of ours to delete', async () => {
    await db.insert(jobs).values({
      id: '88888888-8888-4888-8888-888888888888',
      toolSlug: 'compress-video',
      executionMode: 'client',
      anonFingerprint: 'fp-test',
      inputBytes: 1,
      params: {},
    });

    expect(await sweepExpired(db, storage)).toMatchObject({ examined: 0 });
  });
});
