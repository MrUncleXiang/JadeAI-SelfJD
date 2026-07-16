import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../schema';
import type { DatabaseAdapter } from '../adapter';
import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';

export class SQLiteAdapter implements DatabaseAdapter {
  db;
  private sqlite: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.sqlite = new Database(path);
    this.sqlite.pragma('busy_timeout = 5000');
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('foreign_keys = ON');
    this.db = drizzle(this.sqlite, { schema });
  }

  async initialize(): Promise<void> {
    // Keep migration I/O behind dbReady. Next.js imports route modules in
    // multiple build workers, and imports alone must not race to migrate the
    // same SQLite file.
    migrate(this.db, { migrationsFolder: resolve(process.cwd(), 'drizzle/migrations') });

    if (process.env.SEED_DEMO_DATA !== 'true') return;
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SEED_DEMO_DATA must not be enabled in production');
    }

    const row = this.sqlite.prepare('SELECT count(*) as count FROM users').get() as { count?: number };
    if (row?.count === 0) {
      const { seedDemoUser } = await import('../seed-demo');
      await seedDemoUser(this.db);
      console.log('[DB] SQLite demo seed complete');
    }
  }

  async close(): Promise<void> {
    this.sqlite.close();
  }
}
