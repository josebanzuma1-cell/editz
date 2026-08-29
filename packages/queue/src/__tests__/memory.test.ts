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

/**
 * Waits for a condition instead of for a duration.
 *
 * Sleeping "long enough" is how a suite becomes flaky: it passes on an idle
 * laptop and fails when CI runs six packages at once, and a test that fails
 * randomly gets ignored — at which point it protects nothing. Polling a
 * predicate is deterministic under any amount of load; only the timeout is
 * time-based, and that fires only on genuine failure.
 */
async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitFor: condition never became true');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

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
    await waitFor(() => seen.length === 2);

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
    await waitFor(() => seen.length === 3);

    expect(seen[0]).toBe('pro');
  });

  it('respects concurrency rather than starting everything at once', async () => {
    queue = new MemoryQueue();
    let running = 0;
    let peak = 0;
    let done = 0;

    queue.consume(
      async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 20));
        running--;
        done++;
      },
      { concurrency: 2 },
    );

    for (const id of ['a', 'b', 'c', 'd']) await queue.enqueue(job(id));
    // Wait for the work to finish, then assert — so exceeding the limit is a
    // clear assertion failure rather than a timeout with nothing to read.
    await waitFor(() => done === 4, 10_000);

    expect(peak).toBe(2);
  });

  it('retries a failure and reports the attempt number', async () => {
    queue = new MemoryQueue({ backoffMs: 5 });
    const attempts: number[] = [];

    queue.consume(async (_j, ctx) => {
      attempts.push(ctx.attempt);
      if (ctx.attempt < 3) throw new Error('transient');
    });

    await queue.enqueue(job('flaky'));
    await waitFor(() => attempts.length === 3);

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
    await waitFor(() => queue.dead.length === 1);

    expect(queue.dead).toHaveLength(1);
    expect(queue.dead[0]?.job.jobId).toBe('doomed');
  });

  it('backs off between attempts instead of hammering', async () => {
    const backoffMs = 60;
    queue = new MemoryQueue({ backoffMs });
    const times: number[] = [];
    queue.consume(async () => {
      times.push(Date.now());
      throw new Error('nope');
    });

    await queue.enqueue(job('slow-retry'), { attempts: 3 });
    await waitFor(() => times.length === 3);

    // Only a lower bound is asserted. Under load the gap can be arbitrarily
    // *longer*, and a test that also caps it would fail for the one reason
    // that is not a bug.
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(backoffMs * 0.8);
    // Exponential, so the second wait is longer than the first.
    expect(times[2]! - times[1]!).toBeGreaterThan(times[1]! - times[0]!);
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
    await waitFor(() => handler.mock.calls.length === 1);
    await queue.close();
    // Long enough that a scheduled retry would certainly have fired.
    await new Promise((r) => setTimeout(r, 300));

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
