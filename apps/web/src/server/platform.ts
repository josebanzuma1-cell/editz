import 'server-only';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createDatabase, type Database } from '@editz/db';
import {
  LocalStorage,
  R2Storage,
  type Storage as ObjectStorage,
} from '@editz/storage';
import {
  BullQueueAdapter,
  MemoryProgressStore,
  MemoryQueue,
  RedisProgressStore,
  type ProgressStore,
  type Queue,
} from '@editz/queue';
import { SITE_URL } from '@/lib/site';

/**
 * Everything with a connection string, chosen once.
 *
 * Each dependency falls back to a local implementation when its environment
 * variable is absent, so `pnpm dev` runs the entire §7 lifecycle — presign,
 * upload, enqueue, process, progress, download, expire — with nothing
 * installed. That is not a convenience: a server path that only the person
 * holding the credentials can exercise is a server path first exercised in
 * production.
 *
 * Production is the same code with the variables set.
 */
export interface Platform {
  db: Database;
  storage: ObjectStorage;
  queue: Queue;
  progress: ProgressStore;
  /** True when any dependency is the local stand-in. Surfaced in health. */
  isLocal: boolean;
}

const DEV_ROOT = join(process.cwd(), '.editz-dev');

let platform: Platform | null = null;
let creating: Promise<Platform> | null = null;

export function getPlatform(): Promise<Platform> {
  if (platform) return Promise.resolve(platform);
  creating ??= build().then((built) => {
    platform = built;
    return built;
  });
  return creating;
}

async function build(): Promise<Platform> {
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  const r2 = readR2Config();
  const isLocal = !databaseUrl || !redisUrl || !r2;

  if (isLocal) mkdirSync(DEV_ROOT, { recursive: true });

  const db = databaseUrl
    ? createDatabase(databaseUrl)
    : ((await (
        await import('@editz/db/dev')
      ).createDevDatabase(join(DEV_ROOT, 'postgres'))) as unknown as Database);

  const storage: ObjectStorage = r2
    ? new R2Storage(r2)
    : new LocalStorage({
        root: join(DEV_ROOT, 'storage'),
        // Development only, and regenerated per boot unless pinned, so a
        // signature from one dev session is worthless in the next.
        secret: process.env.DEV_STORAGE_SECRET ?? 'editz-dev-signing-secret',
        publicOrigin: SITE_URL,
      });

  const queue: Queue = redisUrl
    ? new BullQueueAdapter({ redisUrl })
    : new MemoryQueue({ backoffMs: 2000 });

  const progress: ProgressStore = redisUrl
    ? new RedisProgressStore(redisUrl)
    : new MemoryProgressStore();

  return { db, storage, queue, progress, isLocal };
}

function readR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

/** The local signing implementation, for the dev-storage route to verify with. */
export async function getLocalStorage(): Promise<LocalStorage | null> {
  const { storage } = await getPlatform();
  return storage instanceof LocalStorage ? storage : null;
}
