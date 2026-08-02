import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * The schema from §6.
 *
 * Two things here are load-bearing and worth stating rather than leaving to be
 * inferred from column names:
 *
 * 1. **Client-side jobs still get a row** — with `inputKey` null, because
 *    nothing was uploaded. That is what keeps quota and analytics uniform
 *    across both execution paths instead of the client path being invisible.
 *    The check constraint below makes the invariant impossible to violate:
 *    a client job may not have an input key, a server job must have one.
 *
 * 2. **`expiresAt` is not decoration.** §11 says no file is retained past 24
 *    hours. The lifecycle rule on the bucket is the mechanism; this column is
 *    the record, and the sweeper reads it.
 */

export const planEnum = pgEnum('plan', ['free', 'pro']);
export const jobStatusEnum = pgEnum('job_status', ['queued', 'processing', 'done', 'failed']);
export const executionModeEnum = pgEnum('execution_mode', ['client', 'server']);
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'active',
  'past_due',
  'cancelled',
  'expired',
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name'),
    image: text('image'),
    plan: planEnum('plan').notNull().default('free'),
    planExpiresAt: timestamp('plan_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_idx').on(table.email)],
);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Nullable: the core path works without an account, and requiring one
    // would destroy the SEO funnel (§8).
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Anonymous quota is fingerprint-based, so unauthenticated jobs are still
     *  attributable to *someone* without being attributable to a person. */
    anonFingerprint: text('anon_fingerprint'),

    toolSlug: text('tool_slug').notNull(),
    executionMode: executionModeEnum('execution_mode').notNull(),
    status: jobStatusEnum('status').notNull().default('queued'),

    inputBytes: bigint('input_bytes', { mode: 'number' }).notNull(),
    outputBytes: bigint('output_bytes', { mode: 'number' }),

    inputKey: text('input_key'),
    outputKey: text('output_key'),

    params: jsonb('params').notNull(),
    /** A mapped, human-readable code — never FFmpeg's stderr (§7). */
    error: text('error'),
    progress: real('progress').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** Null for client jobs: there is no artefact of ours to expire. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [
    index('jobs_status_idx').on(table.status),
    index('jobs_expires_at_idx').on(table.expiresAt),
    index('jobs_user_idx').on(table.userId),
    // The invariant from §6, enforced by the database rather than by whoever
    // writes the next insert.
    check(
      'jobs_client_has_no_input_key',
      sql`(${table.executionMode} = 'server' AND ${table.inputKey} IS NOT NULL)
          OR (${table.executionMode} = 'client' AND ${table.inputKey} IS NULL)`,
    ),
    check('jobs_progress_range', sql`${table.progress} >= 0 AND ${table.progress} <= 1`),
    // A job is attributable to an account or to a fingerprint. Neither means
    // it cannot be counted against any quota at all.
    check(
      'jobs_has_an_owner',
      sql`${table.userId} IS NOT NULL OR ${table.anonFingerprint} IS NOT NULL`,
    ),
  ],
);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** The multi-track editor's document. Opaque here on purpose — the editor
     *  owns its shape and this table should not need migrating when it changes. */
    timeline: jsonb('timeline').notNull(),
    thumbnailKey: text('thumbnail_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('projects_user_idx').on(table.userId)],
);

export const usage = pgTable(
  'usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    anonFingerprint: text('anon_fingerprint'),
    toolSlug: text('tool_slug').notNull(),
    executionMode: executionModeEnum('execution_mode').notNull(),
    bytesProcessed: bigint('bytes_processed', { mode: 'number' }).notNull(),
    executedAt: timestamp('executed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The quota query is "this identity, since midnight", so it is indexed
    // that way rather than by identity alone.
    index('usage_user_day_idx').on(table.userId, table.executedAt),
    index('usage_anon_day_idx').on(table.anonFingerprint, table.executedAt),
    check(
      'usage_has_an_owner',
      sql`${table.userId} IS NOT NULL OR ${table.anonFingerprint} IS NOT NULL`,
    ),
  ],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'stripe' | 'paystack' | 'flutterwave'. Text rather than an enum because
     *  §3 wants a second African payment provider to be an addition, not a
     *  migration. */
    provider: text('provider').notNull(),
    providerRef: text('provider_ref').notNull(),
    status: subscriptionStatusEnum('status').notNull(),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('subscriptions_provider_ref_idx').on(table.provider, table.providerRef),
    index('subscriptions_user_idx').on(table.userId),
  ],
);

/** Retention in hours. Stated once, here, because §11 makes it a promise. */
export const RETENTION_HOURS = 24;

export const schema = { users, jobs, projects, usage, subscriptions };

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type Usage = typeof usage.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
