import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { schema } from './schema';

export * from './schema';

export type Database = ReturnType<typeof createDatabase>;

/**
 * The production connection.
 *
 * Pool size is deliberately small: the web app runs serverless, so every
 * instance holds its own pool, and a generous number per instance is how a
 * managed Postgres runs out of connections under load rather than under
 * traffic. The worker opens its own with a larger pool.
 */
export function createDatabase(connectionString: string, options: { max?: number } = {}) {
  const client = postgres(connectionString, {
    max: options.max ?? 5,
    // Job rows are small and the queries are simple; a long statement here
    // means something is wrong, not something is busy.
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return drizzle(client, { schema });
}
