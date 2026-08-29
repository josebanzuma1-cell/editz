import 'server-only';
import { and, eq, gte, sql } from 'drizzle-orm';
import { usage, type Database } from '@editz/db';
import { FREE_FILE_LIMIT_BYTES, PRO_FILE_LIMIT_BYTES } from '@/lib/site';

/**
 * Quota, enforced server-side (§8).
 *
 * The client checks the same numbers, but only as a UX hint — it can be edited
 * by anyone who opens devtools, so it is not where the decision is made.
 *
 * Note what is *not* here: client-side jobs are recorded in `usage` but are not
 * charged against the daily allowance. They cost us nothing — no upload, no
 * compute, no egress — and metering work we did not perform would punish
 * exactly the behaviour the product is built to encourage.
 */
export type Plan = 'free' | 'pro';

/** Generous: this exists to stop scripted abuse, not to ration ordinary use. */
const DAILY_SERVER_BYTES: Record<Plan, number> = {
  free: 2 * 1024 * 1024 * 1024,
  pro: 100 * 1024 * 1024 * 1024,
};

export const FILE_LIMIT: Record<Plan, number> = {
  free: FREE_FILE_LIMIT_BYTES,
  pro: PRO_FILE_LIMIT_BYTES,
};

export type QuotaDenial =
  | { code: 'file-too-large'; limitBytes: number; actualBytes: number }
  | { code: 'daily-limit-reached'; limitBytes: number; usedBytes: number }
  | { code: 'pro-only' };

export interface QuotaCheck {
  plan: Plan;
  bytes: number;
  toolIsPro: boolean;
  userId?: string | undefined;
  anonFingerprint?: string | undefined;
}

export async function checkQuota(
  db: Database,
  check: QuotaCheck,
): Promise<QuotaDenial | null> {
  if (check.toolIsPro && check.plan !== 'pro') return { code: 'pro-only' };

  const fileLimit = FILE_LIMIT[check.plan];
  if (check.bytes > fileLimit) {
    return { code: 'file-too-large', limitBytes: fileLimit, actualBytes: check.bytes };
  }

  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const owner = check.userId
    ? eq(usage.userId, check.userId)
    : check.anonFingerprint
      ? eq(usage.anonFingerprint, check.anonFingerprint)
      : null;
  if (!owner) return null;

  const [row] = await db
    .select({ bytes: sql<string>`coalesce(sum(${usage.bytesProcessed}), 0)` })
    .from(usage)
    .where(and(owner, gte(usage.executedAt, since), eq(usage.executionMode, 'server')));

  const used = Number(row?.bytes ?? 0);
  const dailyLimit = DAILY_SERVER_BYTES[check.plan];
  if (used + check.bytes > dailyLimit) {
    return { code: 'daily-limit-reached', limitBytes: dailyLimit, usedBytes: used };
  }

  return null;
}

export async function recordUsage(
  db: Database,
  entry: {
    userId?: string | undefined;
    anonFingerprint?: string | undefined;
    toolSlug: string;
    executionMode: 'client' | 'server';
    bytesProcessed: number;
  },
): Promise<void> {
  await db.insert(usage).values({
    ...(entry.userId ? { userId: entry.userId } : {}),
    ...(entry.anonFingerprint ? { anonFingerprint: entry.anonFingerprint } : {}),
    toolSlug: entry.toolSlug,
    executionMode: entry.executionMode,
    bytesProcessed: entry.bytesProcessed,
  });
}
