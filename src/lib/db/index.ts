import { config } from '@/lib/config';
import { SQLiteAdapter } from './adapters/sqlite';
import { PostgreSQLAdapter } from './adapters/postgresql';
import type { DatabaseAdapter } from './adapter';

let adapter: DatabaseAdapter;

if (config.db.type === 'postgresql') {
  adapter = new PostgreSQLAdapter(process.env.DATABASE_URL!);
} else {
  if (process.env.VERCEL) {
    throw new Error(
      'SQLite is not supported on Vercel (read-only filesystem). ' +
      'Please set DB_TYPE=postgresql and DATABASE_URL in your Vercel environment variables.',
    );
  }
  adapter = new SQLiteAdapter(process.env.SQLITE_PATH || './data/jade.db');
}

// Initialization is lazy so importing route modules during `next build` does
// not connect to PostgreSQL or race multiple workers against one SQLite file.
// The first real DB operation still fails closed if migration fails.
let initPromise: Promise<void> | undefined;
function initializeDatabase(): Promise<void> {
  initPromise ??= adapter.initialize();
  return initPromise;
}

/** Await this before any DB operation to ensure tables exist. */
export const dbReady: PromiseLike<void> = {
  then(onFulfilled, onRejected) {
    return initializeDatabase().then(onFulfilled, onRejected);
  },
};

export const db = adapter.db;
export { adapter };
