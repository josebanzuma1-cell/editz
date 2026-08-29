import type {
  EnqueueOptions,
  JobHandler,
  ProgressStore,
  Queue,
  QueuedJob,
} from './types';

/**
 * In-process queue for development and tests.
 *
 * Not a stub. It honours priority, retries with backoff, gives up after the
 * configured number of attempts, and moves the job aside when it does —
 * because the code above a queue mostly cares about what happens when a job
 * *fails*, and a fake that only handles success proves none of it.
 *
 * What it deliberately does not do is survive a restart or coordinate across
 * processes. That is the whole reason production uses Redis, and pretending
 * otherwise here would hide the difference rather than model it.
 */
export interface MemoryQueueOptions {
  /** Base delay for retry backoff. Tests set this to something tiny. */
  backoffMs?: number;
  defaultAttempts?: number;
}

interface Entry {
  job: QueuedJob;
  priority: number;
  attempts: number;
  attempt: number;
}

export class MemoryQueue implements Queue {
  private readonly pending: Entry[] = [];
  private handler: JobHandler | null = null;
  private concurrency = 1;
  private running = 0;
  private draining = false;
  private closed = false;
  private readonly backoffMs: number;
  private readonly defaultAttempts: number;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  /** Jobs that exhausted their attempts, kept so tests can assert on them. */
  readonly dead: { job: QueuedJob; error: unknown }[] = [];

  constructor(options: MemoryQueueOptions = {}) {
    this.backoffMs = options.backoffMs ?? 1000;
    this.defaultAttempts = options.defaultAttempts ?? 3;
  }

  async enqueue(job: QueuedJob, options?: EnqueueOptions): Promise<void> {
    if (this.closed) throw new Error('queue: closed');
    this.pending.push({
      job,
      priority: options?.priority ?? 0,
      attempts: options?.attempts ?? this.defaultAttempts,
      attempt: 1,
    });
    // Higher priority first; equal priority keeps arrival order.
    this.pending.sort((a, b) => b.priority - a.priority);
    queueMicrotask(() => void this.drain());
  }

  consume(handler: JobHandler, options?: { concurrency?: number }): void {
    this.handler = handler;
    this.concurrency = options?.concurrency ?? 1;
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining || !this.handler) return;
    this.draining = true;
    try {
      while (this.pending.length > 0 && this.running < this.concurrency && !this.closed) {
        const entry = this.pending.shift();
        if (!entry) break;
        this.running++;
        void this.run(entry).finally(() => {
          this.running--;
          void this.drain();
        });
      }
    } finally {
      this.draining = false;
    }
  }

  private async run(entry: Entry): Promise<void> {
    const controller = new AbortController();
    try {
      await this.handler!(entry.job, {
        attempt: entry.attempt,
        signal: controller.signal,
        reportProgress: async () => {
          /* the caller wires a ProgressStore; the queue does not own it */
        },
      });
    } catch (error) {
      if (entry.attempt >= entry.attempts) {
        this.dead.push({ job: entry.job, error });
        return;
      }
      // Exponential backoff, same shape as BullMQ's.
      const delay = this.backoffMs * 2 ** (entry.attempt - 1);
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        if (this.closed) return;
        this.pending.push({ ...entry, attempt: entry.attempt + 1 });
        void this.drain();
      }, delay);
      this.timers.add(timer);
    }
  }

  get size(): number {
    return this.pending.length;
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.pending.length = 0;
  }
}

export class MemoryProgressStore implements ProgressStore {
  private readonly values = new Map<string, number>();
  private readonly listeners = new Map<string, Set<(fraction: number) => void>>();

  async set(jobId: string, fraction: number): Promise<void> {
    const clamped = Math.min(1, Math.max(0, fraction));
    // Monotonic here as well as in the parsers: a progress bar that goes
    // backwards reads as a hang, whichever layer let it.
    const current = this.values.get(jobId) ?? 0;
    if (clamped < current) return;
    this.values.set(jobId, clamped);
    for (const listener of this.listeners.get(jobId) ?? []) listener(clamped);
  }

  async get(jobId: string): Promise<number | null> {
    return this.values.get(jobId) ?? null;
  }

  subscribe(jobId: string, onChange: (fraction: number) => void): () => void {
    const set = this.listeners.get(jobId) ?? new Set();
    set.add(onChange);
    this.listeners.set(jobId, set);
    return () => {
      set.delete(onChange);
      if (set.size === 0) this.listeners.delete(jobId);
    };
  }

  async clear(jobId: string): Promise<void> {
    this.values.delete(jobId);
    this.listeners.delete(jobId);
  }
}
