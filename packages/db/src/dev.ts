import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { schema } from './schema';
import { MIGRATIONS } from './migrations.generated';

/**
 * A real Postgres for development, with nothing to install.
 *
 * PGlite is Postgres compiled to wasm, so `pnpm dev` gets the actual database
 * — the same enums, the same check constraints — without Docker, a service, or
 * a connection string. The alternative is that the server path can only be
 * exercised by whoever holds the credentials, which in practice means it is
 * first exercised in production.
 *
 * Persisted to disk so a restart does not lose in-flight jobs mid-debug.
 * Never used when DATABASE_URL is set.
 *
 * The migrations arrive as data rather than as files: this module ends up
 * inside a bundled Next.js route, where reading a sibling directory is not
 * something a bundler can follow and the files would not be deployed anyway.
 */
export type DevDatabase = ReturnType<typeof drizzle<typeof schema>>;

let instance: { db: DevDatabase; client: PGlite } | null = null;

export async function createDevDatabase(dataDir: string): Promise<DevDatabase> {
  if (instance) return instance.db;

  const client = new PGlite(dataDir);
  await applyMigrations(client);
  const db = drizzle(client, { schema });
  instance = { db, client };
  return db;
}

/** Applies every migration not already recorded, in journal order. */
async function applyMigrations(client: PGlite): Promise<void> {
  await client.exec(`
    CREATE TABLE IF NOT EXISTS __editz_migrations (
      tag text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const applied = await client.query<{ tag: string }>('SELECT tag FROM __editz_migrations');
  const seen = new Set(applied.rows.map((row) => row.tag));

  for (const migration of MIGRATIONS) {
    if (seen.has(migration.tag)) continue;
    for (const statement of migration.statements) await client.exec(statement);
    await client.query('INSERT INTO __editz_migrations (tag) VALUES ($1)', [migration.tag]);
  }
}
