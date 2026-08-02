import { eq } from 'drizzle-orm';
import { jobs } from '@editz/db';
import { getPlatform } from '@/server/platform';

export const runtime = 'nodejs';
/** A stream that must not be cached or collapsed into a static response. */
export const dynamic = 'force-dynamic';

/**
 * Step 6 of §7: progress over SSE. Do not poll.
 *
 * Polling a job that takes four minutes means several hundred requests that
 * mostly say "still working" — billed per invocation, on connections where
 * every round trip is expensive. One held connection costs one.
 *
 * The stream closes itself when the job reaches a terminal state, so the
 * client does not need to decide when to stop listening.
 */
const HEARTBEAT_MS = 15_000;
const MAX_LIFETIME_MS = 30 * 60 * 1000;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { db, progress } = await getPlatform();

  const [initial] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  if (!initial) return new Response('not found', { status: 404 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
        clearInterval(poll);
        clearTimeout(lifetime);
        controller.close();
      };

      // Whatever we already know, immediately — a client that connects late
      // should not sit at 0% until the next tick.
      send('status', {
        status: initial.status,
        progress: initial.progress,
        error: initial.error,
      });
      if (initial.status === 'done' || initial.status === 'failed') {
        close();
        return;
      }

      const unsubscribe = progress.subscribe(id, (fraction) => {
        send('progress', { progress: fraction });
      });

      // Progress arrives by subscription; *status* changes are written by the
      // worker to Postgres, which has nothing to push with. This poll is
      // deliberately slow — it is a backstop for the terminal transition, not
      // the mechanism.
      const poll = setInterval(() => {
        void (async () => {
          const [row] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
          if (!row || closed) return;
          if (row.status === 'done' || row.status === 'failed') {
            send('status', { status: row.status, progress: row.progress, error: row.error });
            close();
          }
        })();
      }, 2000);

      // Proxies and load balancers drop a connection that says nothing.
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(': keep-alive\n\n'));
      }, HEARTBEAT_MS);

      // A job that never terminates must not hold a connection open forever.
      const lifetime = setTimeout(() => {
        send('status', { status: 'timeout' });
        close();
      }, MAX_LIFETIME_MS);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Nginx buffers proxied responses by default, which turns a live stream
      // into one delivery at the end.
      'x-accel-buffering': 'no',
    },
  });
}
