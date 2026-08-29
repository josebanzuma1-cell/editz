/**
 * The job queue and the progress store, behind interfaces.
 *
 * BullMQ needs real Redis — its correctness comes from Lua scripts, so the
 * in-memory Redis mocks do not work with it. That would mean the §7 lifecycle
 * could only ever be exercised against infrastructure, which is how a
 * lifecycle bug reaches production instead of a test.
 *
 * So: an interface, a memory implementation for development and tests, and a
 * BullMQ implementation for the worker fleet. The memory one is not a stub —
 * it retries with backoff and moves failed jobs aside, because a fake that
 * only does the happy path proves nothing about the code above it.
 */

export interface QueuedJob {
  jobId: string;
  toolSlug: string;
  /** Where the input lives. Server jobs always have one (§6). */
  inputKeys: string[];
  params: unknown;
  /** For the worker's own accounting, not for trusting. */
  inputBytes: number;
}

export interface EnqueueOptions {
  /** Pro jobs jump the queue (§8). Higher runs sooner. */
  priority?: number;
  attempts?: number;
}

export type JobHandler = (job: QueuedJob, context: JobContext) => Promise<void>;

export interface JobContext {
  /** 0–1. Written to the progress store, which SSE reads (§7). */
  reportProgress: (fraction: number) => Promise<void>;
  /** Which try this is, from 1. */
  attempt: number;
  signal: AbortSignal;
}

export interface Queue {
  enqueue(job: QueuedJob, options?: EnqueueOptions): Promise<void>;
  /** Starts consuming. Worker side only. */
  consume(handler: JobHandler, options?: { concurrency?: number }): void;
  close(): Promise<void>;
}

/**
 * Progress lives outside the database on purpose.
 *
 * A job emits progress many times a second; writing each one to Postgres
 * turns a status bar into sustained write load for a number nobody will ever
 * read again. The durable record of *status* stays in `jobs`; the fast-moving
 * number lives here.
 */
export interface ProgressStore {
  set(jobId: string, fraction: number): Promise<void>;
  get(jobId: string): Promise<number | null>;
  /** Fires on every update until the returned function is called. */
  subscribe(jobId: string, onChange: (fraction: number) => void): () => void;
  clear(jobId: string): Promise<void>;
}
