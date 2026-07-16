import assert from 'node:assert/strict';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

interface JournalEntry {
  idx: number;
  tag: string;
}

interface MigrationJournal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

function requireDisposableDatabase(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('DATABASE_URL is required');
  if (process.env.JADE_TEST_DATABASE !== '1') {
    throw new Error('Refusing destructive integration test without JADE_TEST_DATABASE=1');
  }
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error(`Refusing to reset non-local PostgreSQL host: ${url.hostname}`);
  }
  if (!url.pathname.toLowerCase().includes('test')) {
    throw new Error(`Disposable database name must include "test": ${url.pathname}`);
  }
  return value;
}

function migrationSubset(source: string, workdir: string, maxIndex: number): string {
  const subset = join(workdir, `through-${maxIndex}`);
  const meta = join(subset, 'meta');
  mkdirSync(meta, { recursive: true });
  const journal = JSON.parse(
    readFileSync(join(source, 'meta/_journal.json'), 'utf8'),
  ) as MigrationJournal;
  const entries = journal.entries.filter((entry) => entry.idx <= maxIndex);
  for (const entry of entries) {
    copyFileSync(join(source, `${entry.tag}.sql`), join(subset, `${entry.tag}.sql`));
  }
  writeFileSync(
    join(meta, '_journal.json'),
    `${JSON.stringify({ ...journal, entries }, null, 2)}\n`,
  );
  return subset;
}

async function main(): Promise<void> {
  const databaseUrl = requireDisposableDatabase();
  if (process.env.DB_TYPE !== 'postgresql') {
    throw new Error('DB_TYPE=postgresql is required');
  }

  const migrationsFolder = resolve(process.cwd(), 'drizzle/pg-migrations');
  const workdir = mkdtempSync(join(tmpdir(), 'jadeai-postgres-integration-'));
  const client = postgres(databaseUrl, { max: 1 });

  try {
    await client.unsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await client.unsafe('CREATE SCHEMA public');
    await client.unsafe('DROP SCHEMA IF EXISTS drizzle CASCADE');

    const database = drizzle(client);
    await migrate(database, { migrationsFolder: migrationSubset(migrationsFolder, workdir, 3) });
    await client`
      INSERT INTO users (id, email, name, fingerprint, auth_type)
      VALUES
        ('legacy-a', 'Case@Example.com', 'Legacy A', NULL, 'oauth'),
        ('legacy-b', 'case@example.com', 'Legacy B', 'fingerprint-b', 'fingerprint'),
        ('legacy-c', ' Unique@Example.com ', 'Legacy C', NULL, 'oauth')
    `;
    await client`
      INSERT INTO resumes (id, user_id, title)
      VALUES ('legacy-resume', 'legacy-a', 'Preserved resume')
    `;
    await migrate(database, { migrationsFolder });

    const legacyUsers = await client<{
      id: string;
      email_normalized: string | null;
      role: string;
      status: string;
      token_version: number;
    }[]>`
      SELECT id, email_normalized, role, status, token_version
      FROM users
      WHERE id LIKE 'legacy-%'
      ORDER BY id
    `;
    assert.equal(legacyUsers.length, 3);
    assert.equal(legacyUsers[0].email_normalized, null);
    assert.equal(legacyUsers[1].email_normalized, null);
    assert.equal(legacyUsers[2].email_normalized, 'unique@example.com');
    for (const user of legacyUsers) {
      assert.equal(user.role, 'user');
      assert.equal(user.status, 'active');
      assert.equal(user.token_version, 0);
    }
    const conflicts = await client<{ count: number }[]>`
      SELECT count(*)::integer AS count
      FROM audit_events
      WHERE action = 'auth.migration_identity_conflict'
    `;
    assert.equal(conflicts[0].count, 2);
    const resumes = await client<{ title: string }[]>`
      SELECT title FROM resumes WHERE id = 'legacy-resume'
    `;
    assert.equal(resumes[0].title, 'Preserved resume');
  } finally {
    await client.end();
    rmSync(workdir, { recursive: true, force: true });
  }

  const { authService } = await import('../src/lib/auth/service');
  const { adapter } = await import('../src/lib/db');
  const originalPassword = 'Correct-Horse-Battery-2026!';
  const replacementPassword = 'Different-Correct-Horse-2026!';

  try {
    const bootstrapResults = await Promise.allSettled([
      authService.bootstrapAdmin({
        username: 'admin',
        email: 'Admin@Example.com',
        displayName: 'Admin',
        password: originalPassword,
      }),
      authService.bootstrapAdmin({
        username: 'admin-second',
        displayName: 'Admin Second',
        password: originalPassword,
      }),
    ]);
    const successfulBootstrap = bootstrapResults.find(
      (result) => result.status === 'fulfilled',
    );
    assert(successfulBootstrap?.status === 'fulfilled');
    assert.equal(
      bootstrapResults.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    const rejectedBootstrap = bootstrapResults.find((result) => result.status === 'rejected');
    assert(rejectedBootstrap?.status === 'rejected');
    assert.equal(
      (rejectedBootstrap.reason as { code?: string }).code,
      'BOOTSTRAP_DISABLED',
    );
    const admin = successfulBootstrap.value;
    const login = await authService.login(
      { identifier: admin.email || admin.username!, password: originalPassword },
      { requestId: 'postgres-integration-login', ipPrefix: '127.0.0.0/24', userAgent: 'test' },
    );
    const actor = await authService.resolveSession(login.token, 'postgres-integration-resolve');
    assert.equal(actor?.userId, admin.id);
    assert.equal(actor?.role, 'admin');

    await authService.changePassword(admin.id, originalPassword, replacementPassword);
    assert.equal(
      await authService.resolveSession(login.token, 'postgres-integration-revoked'),
      null,
    );
  } finally {
    await adapter.close();
  }

  process.stdout.write(
    'PostgreSQL integration acceptance passed: legacy migration, login, and session revocation.\n',
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
