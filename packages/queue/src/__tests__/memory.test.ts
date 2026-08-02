import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryProgressStore, MemoryQueue } from '../memory';
import type { QueuedJob } from '../types';

const job = (id: string): QueuedJob => ({
  jobId: id,
  toolSlug: 'compress-video',
  inputKeys: [`jobs/${id}/in/a.mp4`],
  params: {},
  inputBytes: 1024,
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

let queue: MemoryQueue;
afterEach(async () => {
  await queue?.close();
});

describe('MemoryQueue', () => {
  it('hands each job to the consumer', async () => {
    queue = new MemoryQueue();
    const seen: string[] = [];
    queue.consume(async (j) => {
      seen.push(j.jobId);
    });

    await queue.enqueue(job('a'));
    await queue.enqueue(job('b'));
    await settle();

    expect(seen).toEqual(['a', 'b']);
  });

  it('runs higher priority first, which is what Pro buys (§8)', async () => {
    queue = new MemoryQueue();
    const seen: string[] = [];
    // Enqueue before consuming so the ordering is the queue's, not arrival's.
    await queue.enqueue(job('free-1'), { priority: 0 });
    await queue.enqueue(job('pro'), { priority: 10 });
    await queue.enqueue(job('free-2'), { priority: 0 });

    queue.consume(async (j) => {
      seen.push(j.jobId);
    });
    await settle();

    expect(seen[0]).toBe('pro');
  });

  it('respects concurrency rather than starting everything at once', async () => {
    queue = new MemoryQueue();
    let running = 0;
    let peak = 0;

    queue.consume(
      async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 20));
        running--;
      },
      { concurrency: 2 },
    );

    for (const id of ['a', 'b', 'c', 'd']) await queue.enqueue(job(id));
    await new Promise((r) => setTimeout(r, 150));

    expect(peak).toBeLessThanOrEqual(2);
  });

  it('retries a failure and reports the attempt number', async () => {
    queue = new MemoryQueue({ backoffMs: 5 });
    const attempts: number[] = [];

    queue.consume(async (_j, ctx) => {
      attempts.push(ctx.attempt);
      if (ctx.attempt < 3) throw new Error('transient');
    });

    await queue.enqueue(job('flaky'));
    await new Promise((r) => setTimeout(r, 200));

    expect(attempts).toEqual([1, 2, 3]);
    expect(queue.dead).toHaveLength(0);
  });

  it('gives up after the configured attempts and keeps the job', async () => {
    // §7: three retries then a failed status carrying a readable message. The
    // job has to survive so there is something to report.
    queue = new MemoryQueue({ backoffMs: 5 });
    queue.consume(async () => {
      throw new Error('always broken');
    });

    await queue.enqueue(job('doomed'), { attempts: 2 });
    await new Promise((r) => setTimeout(r, 200));

    expect(queue.dead).toHaveLength(1);
    expect(queue.dead[0]?.job.jobId).toBe('doomed');
  });

  it('backs off between attempts instead of hammering', async () => {
    queue = new MemoryQueue({ backoffMs: 40 });
    const times: number[] = [];
    queue.consume(async () => {
      times.push(Date.now());
      throw new Error('nope');
    });

    await queue.enqueue(job('slow-retry'), { attempts: 3 });
    await new Promise((r) => setTimeout(r, 400));

    expect(times.length).toBeGreaterThanOrEqual(2);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(30);
  });

  it('stops accepting work once closed', async () => {
    queue = new MemoryQueue();
    await queue.close();
    await expect(queue.enqueue(job('late'))).rejects.toThrow(/closed/);
  });

  it('does not run a retry that was scheduled before closing', async () => {
    queue = new MemoryQueue({ backoffMs: 50 });
    const handler = vi.fn(async () => {
      throw new Error('fail');
    });
    queue.consume(handler);

    await queue.enqueue(job('cancelled'));
    await settle();
    await queue.close();
    await new Promise((r) => setTimeout(r, 150));

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('MemoryProgressStore', () => {
  it('stores and returns a fraction', async () => {
    const store = new MemoryProgressStore();
    await store.set('a', 0.4);
    expect(await store.get('a')).toBeCloseTo(0.4);
  });

  it('knows nothing about a job it has not seen', async () => {
    expect(await new MemoryProgressStore().get('missing')).toBeNull();
  });

  it('never goes backwards, whatever it is told', async () => {
    // A bar that jumps back reads as a hang, whichever layer allowed it.
    const store = new MemoryProgressStore();
    await store.set('a', 0.8);
    await store.set('a', 0.2);
    expect(await store.get('a')).toBeCloseTo(0.8);
  });

  it('clamps to 0..1', async () => {
    const store = new MemoryProgressStore();
    await store.set('a', 5);
    expect(await store.get('a')).toBe(1);
  });

  it('notifies subscribers, which is what SSE is reading', async () => {
    const store = new MemoryProgressStore();
    const seen: number[] = [];
    const stop = store.subscribe('a', (f) => seen.push(f));

    await store.set('a', 0.25);
    await store.set('a', 0.5);
    stop();
    await store.set('a', 0.75);

    expect(seen).toEqual([0.25, 0.5]);
  });

  it('forgets a job on clear, so progress does not outlive its job', async () => {
    const store = new MemoryProgressStore();
    await store.set('a', 0.5);
    await store.clear('a');
    expect(await store.get('a')).toBeNull();
  });
});
