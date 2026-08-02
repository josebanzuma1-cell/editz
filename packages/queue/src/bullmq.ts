import { Queue as BullQueue, Worker, type JobsOptions } from 'bullmq';
import Redis from 'ioredis';
import type {
  EnqueueOptions,
  JobHandler,
  ProgressStore,
  Queue,
  QueuedJob,
} from './types';

/**
 * BullMQ on Redis, for the worker fleet.
 *
 * NOT YET EXERCISED — there is no Redis on the machine this was written on.
 * Everything above the `Queue` interface is tested against MemoryQueue, so
 * what is unverified is this adapter alone, which is the point of the
 * interface.
 *
 * Two settings here are decisions rather than defaults:
 *
 * `maxStalledCount` and a long `lockDuration`, because a video encode holds
 * its lock for minutes without doing anything Redis can see. The default
 * 30-second lock declares a perfectly healthy 4K encode stalled and hands it
 * to a second worker, which is how you get the same job encoded twice and
 * billed twice.
 *
 * `removeOnFail: false`, because a failed job is the only record of *why* a
 * user's file did not come back.
 */
export interface BullQueueOptions {
  redisUrl: string;
  queueName?: string;
  /** Must exceed the longest job a worker will ever hold. */
  lockDurationMs?: number;
}

const DEFAULT_QUEUE = 'editz-jobs';

export class BullQueueAdapter implements Queue {
  private readonly connection: Redis;
  private readonly queue: BullQueue;
  private worker: Worker | null = null;
  private readonly name: string;
  private readonly lockDurationMs: number;

  constructor(options: BullQueueOptions) {
    // BullMQ requires this to be null rather than the ioredis default, or
    // blocking commands throw after a reconnect.
    this.connection = new Redis(options.redisUrl, { maxRetriesPerRequest: null });
    this.name = options.queueName ?? DEFAULT_QUEUE;
    this.lockDurationMs = options.lockDurationMs ?? 30 * 60 * 1000;
    this.queue = new BullQueue(this.name, { connection: this.connection });
  }

  async enqueue(job: QueuedJob, options?: EnqueueOptions): Promise<void> {
    const jobOptions: JobsOptions = {
      jobId: job.jobId,
      attempts: options?.attempts ?? 3,
      backoff: { type: 'exponential', delay: 5000 },
      // Done jobs are cleaned up by the 24-hour sweep; failures are kept
      // because they are the only record of why a file did not come back.
      removeOnComplete: { age: 3600 },
      removeOnFail: false,
      ...(options?.priority !== undefined ? { priority: options.priority } : {}),
    };
    await this.queue.add('process', job, jobOptions);
  }

  consume(handler: JobHandler, options?: { concurrency?: number }): void {
    this.worker = new Worker(
      this.name,
      async (job) => {
        const controller = new AbortController();
        await handler(job.data as QueuedJob, {
          attempt: job.attemptsMade + 1,
          signal: controller.signal,
          reportProgress: async (fraction) => {
            await job.updateProgress(Math.round(fraction * 100));
          },
        });
      },
      {
        connection: this.connection,
        concurrency: options?.concurrency ?? 1,
        lockDuration: this.lockDurationMs,
        // An encode that holds its lock without touching Redis is working,
        // not stalled. Re-running it would double the compute and the bill.
        maxStalledCount: 1,
      },
    );
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
    this.connection.disconnect();
  }
}

/**
 * Progress in Redis, published so every web instance sees it.
 *
 * SSE connections land on whichever instance the load balancer picked, which
 * is rarely the one that enqueued the job and never the worker running it —
 * so a value in one process's memory is invisible to the connection that
 * needs it. Pub/sub is what makes progress work behind more than one replica.
 */
export class RedisProgressStore implements ProgressStore {
  private readonly writer: Redis;
  private readonly subscriber: Redis;
  private readonly listeners = new Map<string, Set<(fraction: number) => void>>();

  constructor(redisUrl: string, private readonly ttlSeconds = 3600) {
    this.writer = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.subscriber = new Redis(redisUrl, { maxRetriesPerRequest: null });

    this.subscriber.on('message', (channel, message) => {
      const jobId = channel.slice('editz:progress:'.length);
      const fraction = Number(message);
      if (!Number.isFinite(fraction)) return;
      for (const listener of this.listeners.get(jobId) ?? []) listener(fraction);
    });
  }

  private key = (jobId: string) => `editz:progress:${jobId}`;

  async set(jobId: string, fraction: number): Promise<void> {
    const clamped = Math.min(1, Math.max(0, fraction));
    // Expiring: a progress value outliving its job is landfill.
    await this.writer.set(this.key(jobId), String(clamped), 'EX', this.ttlSeconds);
    await this.writer.publish(this.key(jobId), String(clamped));
  }

  async get(jobId: string): Promise<number | null> {
    const raw = await this.writer.get(this.key(jobId));
    return raw === null ? null : Number(raw);
  }

  subscribe(jobId: string, onChange: (fraction: number) => void): () => void {
    const set = this.listeners.get(jobId) ?? new Set();
    set.add(onChange);
    this.listeners.set(jobId, set);
    void this.subscriber.subscribe(this.key(jobId));

    return () => {
      set.delete(onChange);
      if (set.size === 0) {
        this.listeners.delete(jobId);
        void this.subscriber.unsubscribe(this.key(jobId));
      }
    };
  }

  async clear(jobId: string): Promise<void> {
    await this.writer.del(this.key(jobId));
    this.listeners.delete(jobId);
  }

  async close(): Promise<void> {
    this.writer.disconnect();
    this.subscriber.disconnect();
  }
}
