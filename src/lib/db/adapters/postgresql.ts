import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import type { DatabaseAdapter } from '../adapter';
import { resolve } from 'path';

export class PostgreSQLAdapter implements DatabaseAdapter {
  db;
  private client: ReturnType<typeof postgres>;

  constructor(connectionString: string) {
    this.client = postgres(connectionString);
    this.db = drizzle(this.client);
  }

  async initialize(): Promise<void> {
    // Auto-run migrations (PG-native migration files)
    await migrate(this.db, {
      migrationsFolder: resolve(process.cwd(), 'drizzle/pg-migrations'),
    });

    // Sanity check: if migration tracking says "done" but tables are missing
    // (e.g. after a manual DROP SCHEMA), reset tracking and re-run.
    const check = await this.db.execute(
      sql`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') AS ok`,
    );
    if (!(check as unknown as Array<{ ok?: boolean }>)[0]?.ok) {
      console.warn('[DB] Migration tracking is stale — resetting and re-running');
      await this.db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
      await migrate(this.db, {
        migrationsFolder: resolve(process.cwd(), 'drizzle/pg-migrations'),
      });
    }
    console.log('[DB] PostgreSQL migrations applied');

    if (process.env.SEED_DEMO_DATA !== 'true') return;
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SEED_DEMO_DATA must not be enabled in production');
    }

    const result = await this.db.execute(sql`SELECT count(*)::int as count FROM users`);
    const count = Number((result as unknown as Array<{ count?: number }>)[0]?.count ?? 0);
    if (count === 0) {
      const { seedDemoUser } = await import('../seed-demo');
      await seedDemoUser(this.db);
      console.log('[DB] PostgreSQL demo seed complete');
    }
  }

  async close(): Promise<void> {
    await this.client.end();
  }
}
