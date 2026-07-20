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

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

interface JournalEntry {
  idx: number;
  tag: string;
}

interface MigrationJournal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

const migrationsFolder = resolve(process.cwd(), 'drizzle/migrations');
const workdir = mkdtempSync(join(tmpdir(), 'jadeai-sqlite-migrations-'));

function migrationSubset(maxIndex: number): string {
  const subset = join(workdir, `through-${maxIndex}`);
  const meta = join(subset, 'meta');
  mkdirSync(meta, { recursive: true });

  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
  ) as MigrationJournal;
  const entries = journal.entries.filter((entry) => entry.idx <= maxIndex);
  for (const entry of entries) {
    copyFileSync(
      join(migrationsFolder, `${entry.tag}.sql`),
      join(subset, `${entry.tag}.sql`),
    );
  }
  writeFileSync(
    join(meta, '_journal.json'),
    `${JSON.stringify({ ...journal, entries }, null, 2)}\n`,
  );
  return subset;
}

function openDatabase(path: string): Database.Database {
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return sqlite;
}

function assertHealthy(sqlite: Database.Database): void {
  assert.equal(
    (sqlite.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check,
    'ok',
  );
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
}

function testFreshInstall(): void {
  const path = join(workdir, 'fresh.db');
  const sqlite = openDatabase(path);
  migrate(drizzle(sqlite), { migrationsFolder });

  const tables = new Set(
    (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
      .map((row) => row.name),
  );
  for (const table of [
    'users',
    'password_credentials',
    'auth_sessions',
    'auth_rate_limits',
    'invitations',
    'system_settings',
    'audit_events',
    'resume_versions',
    'resume_change_sets',
    'resume_change_operations',
    'source_connections',
    'github_connection_states',
    'github_installations',
    'source_repositories',
    'source_snapshots',
    'source_documents',
    'sync_jobs',
    'webhook_deliveries',
    'career_facts',
    'career_fact_evidence',
    'career_fact_claims',
    'career_fact_relations',
    'fact_review_events',
  ]) {
    assert(tables.has(table), `fresh migration is missing table ${table}`);
  }
  const documentColumns = new Set(
    (sqlite.prepare('PRAGMA table_info(source_documents)').all() as Array<{ name: string }>)
      .map((row) => row.name),
  );
  assert(documentColumns.has('security_findings'));
  assert(documentColumns.has('llm_eligible'));
  const jdSourceColumns = new Set(
    (sqlite.prepare('PRAGMA table_info(jd_sources)').all() as Array<{ name: string }>)
      .map((row) => row.name),
  );
  assert(jdSourceColumns.has('last_request_id'));
  const resumeColumns = new Set(
    (sqlite.prepare('PRAGMA table_info(resumes)').all() as Array<{ name: string }>)
      .map((row) => row.name),
  );
  assert(resumeColumns.has('kind'));
  assert(resumeColumns.has('parent_resume_id'));
  assert(resumeColumns.has('target_jd_source_id'));
  const githubColumns = sqlite.prepare(`
    SELECT m.name AS table_name, p.name AS column_name
    FROM sqlite_master AS m, pragma_table_info(m.name) AS p
    WHERE m.type = 'table'
      AND m.name IN ('source_connections', 'github_connection_states', 'github_installations', 'sync_jobs', 'webhook_deliveries')
  `).all() as Array<{ table_name: string; column_name: string }>;
  assert.equal(
    githubColumns.some((column) => /(?:access_)?token|private_key/i.test(column.column_name)),
    false,
    'GitHub credentials must not be persisted in application tables',
  );
  assertHealthy(sqlite);
  sqlite.close();
}

function testLegacyUpgrade(): void {
  const path = join(workdir, 'upgrade.db');
  const sqlite = openDatabase(path);
  const database = drizzle(sqlite);
  migrate(database, { migrationsFolder: migrationSubset(5) });

  const insertUser = sqlite.prepare(
    'INSERT INTO users (id, email, name, fingerprint, auth_type) VALUES (?, ?, ?, ?, ?)',
  );
  insertUser.run('legacy-a', 'Case@Example.com', 'Legacy A', null, 'oauth');
  insertUser.run('legacy-b', 'case@example.com', 'Legacy B', 'fingerprint-b', 'fingerprint');
  insertUser.run('legacy-c', ' Unique@Example.com ', 'Legacy C', null, 'oauth');
  sqlite.prepare(
    'INSERT INTO resumes (id, user_id, title) VALUES (?, ?, ?)',
  ).run('legacy-resume', 'legacy-a', 'Preserved resume');

  migrate(database, { migrationsFolder });

  const users = sqlite.prepare(
    'SELECT id, email_normalized, role, status, token_version FROM users ORDER BY id',
  ).all() as Array<{
    id: string;
    email_normalized: string | null;
    role: string;
    status: string;
    token_version: number;
  }>;
  assert.equal(users.length, 3);
  assert.equal(users[0].email_normalized, null);
  assert.equal(users[1].email_normalized, null);
  assert.equal(users[2].email_normalized, 'unique@example.com');
  for (const user of users) {
    assert.equal(user.role, 'user');
    assert.equal(user.status, 'active');
    assert.equal(user.token_version, 0);
  }

  assert.equal(
    (sqlite.prepare('SELECT title FROM resumes WHERE id = ?').get('legacy-resume') as { title: string }).title,
    'Preserved resume',
  );
  assert.deepEqual(
    sqlite.prepare(
      'SELECT kind, parent_resume_id, target_jd_source_id FROM resumes WHERE id = ?',
    ).get('legacy-resume'),
    { kind: 'baseline', parent_resume_id: null, target_jd_source_id: null },
  );
  for (const table of [
    'resume_versions',
    'resume_change_sets',
    'resume_change_operations',
    'source_connections',
    'github_connection_states',
    'github_installations',
    'source_repositories',
    'source_snapshots',
    'source_documents',
    'sync_jobs',
    'webhook_deliveries',
    'career_facts',
    'career_fact_evidence',
    'career_fact_claims',
    'career_fact_relations',
    'fact_review_events',
  ]) {
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { count: number }).count,
      1,
      `legacy upgrade is missing table ${table}`,
    );
  }
  assert.equal(
    (sqlite.prepare(
      "SELECT count(*) AS count FROM audit_events WHERE action = 'auth.migration_identity_conflict'",
    ).get() as { count: number }).count,
    2,
  );
  assertHealthy(sqlite);
  sqlite.close();
}

try {
  testFreshInstall();
  testLegacyUpgrade();
  process.stdout.write('SQLite migration acceptance passed: fresh install and legacy upgrade.\n');
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
