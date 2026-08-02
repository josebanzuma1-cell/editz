/**
 * Drizzle schema. Lands in M3, when there is something to persist.
 *
 * M1 has no database on purpose: nothing is processed, so there are no jobs,
 * no accounts and no usage to record. Adding Drizzle and a migration runner
 * now would mean a Postgres dependency on every developer machine and in CI to
 * support zero rows.
 *
 * The tables, from §6:
 *
 *   users          plan, plan_expires_at
 *   jobs           tool_slug, execution_mode, status, input/output bytes and
 *                  keys, params, error, progress, expires_at
 *   projects       timeline jsonb, for the multi-track editor
 *   usage          user_id or anon_fingerprint, drives quotas
 *   subscriptions  provider, provider_ref, status, current_period_end
 *
 * One thing worth writing down before it is built: client-side jobs still get
 * a `jobs` row, with `input_key` null, because nothing was uploaded. That is
 * what keeps quota and analytics uniform across both execution paths instead
 * of the client path being invisible.
 */

export const M3_PLACEHOLDER = true;
