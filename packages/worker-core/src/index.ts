import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { jobs, type Database } from '@editz/db';
import { compile, type CompileInput } from '@editz/engine-core';
import { runJob, ServerRunnerError } from '@editz/engine-server';
import type { JobContext, ProgressStore, Queue, QueuedJob } from '@editz/queue';
import { outputKey, type Storage } from '@editz/storage';
import { getTool } from '@editz/tool-registry';

/**
 * Steps 4 and 5 of §7, as a function rather than a process.
 *
 * Keeping the work here rather than in `apps/worker` means the same code runs
 * in the deployed fleet and in-process during `pnpm dev`, so the server path
 * is exercised by anyone running the app rather than only by whoever has
 * Redis. `apps/worker` is a few lines of process lifecycle around this.
 */
export interface WorkerDeps {
  db: Database;
  storage: Storage;
  queue: Queue;
  progress: ProgressStore;
  /** Overrides the binary. Defaults to `ffmpeg` on PATH. */
  ffmpegPath?: string;
  /** Wall clock per job. A pathological input must not hold a slot forever. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
/** Progress is written at most this often — see the note in `handle`. */
const PROGRESS_THROTTLE_MS = 250;

export function startWorker(deps: WorkerDeps, options: { concurrency?: number } = {}): void {
  deps.queue.consume(
    (job, context) => handle(job, context, deps),
    { concurrency: options.concurrency ?? 1 },
  );
}

export async function handle(
  job: QueuedJob,
  context: JobContext,
  deps: WorkerDeps,
): Promise<void> {
  const { db, storage, progress } = deps;

  // The row, not the queue message, is the source of truth.
  //
  // The message is a pointer: it can be stale, replayed after a retry, or
  // simply diverge from what was validated at create time. The params on the
  // row went through the manifest's schema before they were written, and
  // re-reading them means there is exactly one version of what this job is.
  const [row] = await db.select().from(jobs).where(eq(jobs.id, job.jobId)).limit(1);
  if (!row) return;
  if (row.status === 'done') return; // A replayed message must not redo work.

  const tool = getTool(row.toolSlug);
  if (!tool) {
    await markFailed(db, job.jobId, 'unknown-tool');
    return;
  }

  const inputKeys = row.inputKey ? [row.inputKey] : job.inputKeys;
  const scratch = await mkdtemp(join(tmpdir(), `editz-${job.jobId}-`));

  try {
    await db
      .update(jobs)
      .set({ status: 'processing', startedAt: new Date(), progress: 0 })
      .where(eq(jobs.id, job.jobId));

    // Local scratch, not memory: the worker handles files far larger than its
    // heap, so everything streams to disk.
    const inputs: CompileInput[] = [];
    for (const [index, key] of inputKeys.entries()) {
      const fsName = `input${index}${extensionOf(key)}`;
      await storage.downloadTo(key, join(scratch, fsName));
      const info = await stat(join(scratch, fsName));
      inputs.push({
        name: key.split('/').pop() ?? fsName,
        fsName,
        bytes: info.size,
        mime: '',
        kind: tool.kind,
      });
    }

    const params = tool.params.parse(row.params);
    const ops = tool.buildOps(inputs[0]!, params, inputs);
    const compiled = compile(inputs, ops, { outputBaseName: 'output' });

    // Progress is throttled before it reaches Redis. A four-minute encode
    // emits thousands of updates and nobody reads the intermediate values
    // twice; publishing each one turns a status bar into sustained load.
    let lastWrite = 0;
    await runJob(compiled, {
      cwd: scratch,
      timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ...(deps.ffmpegPath ? { ffmpegPath: deps.ffmpegPath } : {}),
      signal: context.signal,
      onProgress: (fraction) => {
        const now = Date.now();
        if (now - lastWrite < PROGRESS_THROTTLE_MS && fraction < 1) return;
        lastWrite = now;
        void progress.set(job.jobId, fraction);
        void context.reportProgress(fraction);
      },
    });

    const producedPath = join(scratch, compiled.outputName);
    const produced = await stat(producedPath);
    const key = outputKey(job.jobId, compiled.outputName);
    await storage.uploadFrom(key, producedPath, contentTypeFor(compiled.outputName));

    await db
      .update(jobs)
      .set({
        status: 'done',
        progress: 1,
        outputKey: key,
        outputBytes: produced.size,
        finishedAt: new Date(),
      })
      .where(eq(jobs.id, job.jobId));

    await progress.set(job.jobId, 1);

    // The input has done its job. Removing it now rather than at the 24-hour
    // sweep halves what is held, and it is the half nobody will ask for.
    for (const key of inputKeys) await storage.delete(key);
  } catch (error) {
    await markFailed(db, job.jobId, userFacingCode(error));
    // Rethrow so the queue can retry. §7 allows three attempts before the
    // failure is final.
    throw error;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * A code, never FFmpeg's stderr (§7).
 *
 * "Invalid data found when processing input" tells a developer the file is
 * corrupt and tells everyone else nothing at all.
 */
function userFacingCode(error: unknown): string {
  if (error instanceof ServerRunnerError) return error.code;
  return 'unknown';
}

async function markFailed(db: Database, id: string, error: string): Promise<void> {
  await db
    .update(jobs)
    .set({ status: 'failed', error, finishedAt: new Date() })
    .where(eq(jobs.id, id));
}

function extensionOf(key: string): string {
  const dot = key.lastIndexOf('.');
  return dot > 0 ? key.slice(dot) : '';
}

const CONTENT_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  opus: 'audio/opus',
  flac: 'audio/flac',
  wav: 'audio/wav',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
};

function contentTypeFor(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

export { sweepExpired } from './sweeper';
