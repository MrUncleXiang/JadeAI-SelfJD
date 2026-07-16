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
    const phaseTables = await client<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'resume_versions',
          'resume_change_sets',
          'resume_change_operations',
          'source_repositories',
          'source_snapshots',
          'source_documents',
          'career_facts',
          'career_fact_evidence',
          'career_fact_claims',
          'career_fact_relations',
          'fact_review_events'
        )
      ORDER BY table_name
    `;
    assert.deepEqual(
      phaseTables.map((row) => row.table_name),
      [
        'career_fact_claims',
        'career_fact_evidence',
        'career_fact_relations',
        'career_facts',
        'fact_review_events',
        'resume_change_operations',
        'resume_change_sets',
        'resume_versions',
        'source_documents',
        'source_repositories',
        'source_snapshots',
      ],
    );
  } finally {
    await client.end();
    rmSync(workdir, { recursive: true, force: true });
  }

  const { authService } = await import('../src/lib/auth/service');
  const { authRepository } = await import('../src/lib/db/repositories/auth.repository');
  const { llmProfileRepository } = await import('../src/lib/db/repositories/llm-profile.repository');
  const { decryptLlmApiKey } = await import('../src/lib/llm/encryption');
  const { llmProfileService } = await import('../src/lib/llm/service');
  const { resumeRepository } = await import('../src/lib/db/repositories/resume.repository');
  const { resumeChangeRepository } = await import('../src/lib/db/repositories/resume-change.repository');
  const { careerRepository } = await import('../src/lib/db/repositories/career.repository');
  const { resumeChangeService } = await import('../src/lib/resume-patch/service');
  const { expectedHashForOperation } = await import('../src/lib/resume-patch/operations');
  const { resumePatchSchema } = await import('../src/lib/resume-patch/schema');
  const { parseResumeSnapshot } = await import('../src/lib/resume-patch/snapshot');
  const { parseWorkResumeV2, toCareerSnapshotImport } = await import('../src/lib/career/workresume-v2');
  const { adapter } = await import('../src/lib/db');
  const originalPassword = 'Correct-Horse-Battery-2026!';
  const replacementPassword = 'Different-Correct-Horse-2026!';
  process.env.LLM_ENCRYPTION_KEYS = JSON.stringify({
    1: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
  });
  process.env.LLM_ENCRYPTION_ACTIVE_KEY_VERSION = '1';
  process.env.LLM_BASE_URL_ALLOWLIST = '';

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

    assert(actor);
    const profileKey = 'postgres-llm-secret-key';
    const profile = await llmProfileService.createProfile(actor, {
      name: 'PostgreSQL profile',
      provider: 'openai-compatible',
      baseUrl: 'https://8.8.8.8/v1',
      modelName: 'integration-model',
      apiKey: profileKey,
    });
    assert.notEqual(profile.encryptedApiKey, profileKey);
    assert.equal(decryptLlmApiKey({
      ciphertext: profile.encryptedApiKey,
      iv: profile.keyIv,
      tag: profile.keyTag,
      keyVersion: profile.keyVersion,
    }, { userId: admin.id, profileId: profile.id }), profileKey);
    await llmProfileService.setBinding(actor, 'resume', profile.id);
    assert.equal((await llmProfileService.listBindings(actor)).resume, profile.id);

    await authRepository.setRegistrationMode('open', admin.id);
    const otherRegistration = await authService.register({
      username: 'postgres-llm-other',
      password: originalPassword,
    }, { requestId: 'postgres-llm-other-register' });
    const otherActor = await authService.resolveSession(
      otherRegistration.token,
      'postgres-llm-other-resolve',
    );
    assert(otherActor);
    assert.equal((await llmProfileService.listProfiles(otherActor)).length, 0);
    await assert.rejects(
      llmProfileService.updateProfile(otherActor, profile.id, { name: 'cross-tenant' }),
      (error: unknown) => (error as { code?: string }).code === 'PROFILE_NOT_FOUND',
    );
    assert.equal(await llmProfileRepository.findOwnedById(otherActor.userId, profile.id), null);

    const parsedWorkResume = await parseWorkResumeV2(resolve('tests/fixtures/workresume-v2'));
    const careerImport = toCareerSnapshotImport(admin.id, parsedWorkResume, {
      commitSha: 'c'.repeat(40),
      treeSha: 'd'.repeat(40),
      defaultBranch: 'main',
      externalRepositoryId: 'sha256:postgres-workresume-fixture',
      displayName: 'PostgreSQL WorkResume Fixture',
    });
    const firstCareerImport = await careerRepository.importSnapshotOwned(careerImport);
    const repeatedCareerImport = await careerRepository.importSnapshotOwned(careerImport);
    assert.equal(firstCareerImport.alreadyImported, false);
    assert.equal(firstCareerImport.factsCreated, 4);
    assert.equal(repeatedCareerImport.alreadyImported, true);
    assert.deepEqual(await careerRepository.listFactsOwned(otherActor.userId), []);
    const careerFacts = await careerRepository.listFactsOwned(admin.id);
    const approvedCareerFact = careerFacts.find(
      (fact: { canonicalKey: string }) => fact.canonicalKey === 'skill:distributed-systems',
    );
    assert(approvedCareerFact);
    await careerRepository.reviewFactOwned(admin.id, approvedCareerFact.id, 'approve', 'postgres verified');
    const careerPolicy = await careerRepository.loadPolicyOwned(admin.id);
    assert.deepEqual(careerPolicy.facts.map((fact) => fact.id), [approvedCareerFact.id]);
    assert(careerPolicy.approvedEvidenceIds.size > 0);
    assert(careerPolicy.forbiddenClaims.includes('Created the OpenTelemetry standard.'));

    const resume = await resumeRepository.createOwned(admin.id, {
      title: 'PostgreSQL ResumePatch',
      template: 'classic',
      language: 'en',
    });
    assert(resume);
    const summarySection = await resumeRepository.createSectionOwned(admin.id, {
      resumeId: resume.id,
      type: 'summary',
      title: 'Summary',
      sortOrder: 0,
      content: { text: 'Original summary' },
    });
    assert(summarySection);
    const baseline = await resumeChangeRepository.ensureCurrentVersionOwned(admin.id, resume.id);
    const snapshot = parseResumeSnapshot(baseline.snapshot);
    const operationWithoutHash = {
      operationId: 'postgres-summary-rewrite',
      type: 'set_field' as const,
      sectionId: summarySection.id,
      expectedHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      value: { field: 'text', value: 'Improved professional summary' },
      reason: 'Improve clarity without adding facts',
      evidenceIds: [],
      jdRequirementIds: [],
      confidence: 0.92,
    };
    const operation = {
      ...operationWithoutHash,
      expectedHash: expectedHashForOperation(snapshot, operationWithoutHash),
    };
    const patch = resumePatchSchema.parse({
      schemaVersion: 1,
      resumeId: resume.id,
      baseVersionId: baseline.id,
      summary: 'PostgreSQL transactional patch',
      operations: [operation],
      warnings: [],
    });
    const changeSet = await resumeChangeService.createFromCandidate({
      userId: admin.id,
      resumeId: resume.id,
      candidate: patch,
      config: { profileId: profile.id, provider: profile.provider, model: profile.modelName },
    });
    assert(changeSet);
    assert.equal(changeSet.status, 'validated');
    await assert.rejects(
      resumeChangeService.getChangeSet(otherActor.userId, resume.id, changeSet.id),
      (error: unknown) => (error as { code?: string }).code === 'CHANGE_SET_NOT_FOUND',
    );
    const applied = await resumeChangeService.apply({
      userId: admin.id,
      resumeId: resume.id,
      changeSetId: changeSet.id,
      operationIds: [operation.operationId],
    });
    assert.equal(applied.changeSet.status, 'applied');
    const updatedResume = await resumeRepository.findOwnedById(admin.id, resume.id);
    assert.equal((updatedResume?.sections[0].content as { text?: string }).text, 'Improved professional summary');
    const versionsAfterApply = await resumeChangeService.listVersions(admin.id, resume.id);
    assert.deepEqual(
      versionsAfterApply.map((version: { versionNumber: number }) => version.versionNumber),
      [2, 1],
    );
    await resumeChangeService.restore(admin.id, resume.id, baseline.id);
    const restoredResume = await resumeRepository.findOwnedById(admin.id, resume.id);
    assert.equal((restoredResume?.sections[0].content as { text?: string }).text, 'Original summary');
    const versionsAfterRestore = await resumeChangeService.listVersions(admin.id, resume.id);
    assert.deepEqual(
      versionsAfterRestore.map((version: { versionNumber: number }) => version.versionNumber),
      [3, 2, 1],
    );

    await authService.changePassword(admin.id, originalPassword, replacementPassword);
    assert.equal(
      await authService.resolveSession(login.token, 'postgres-integration-revoked'),
      null,
    );
  } finally {
    await adapter.close();
  }

  process.stdout.write(
    'PostgreSQL integration acceptance passed: legacy migration, auth lifecycle, encrypted LLM profile, WorkResume knowledge import/review, ResumePatch apply/restore, and tenant isolation.\n',
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
