import path from 'node:path';

import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
});

import { db, dbReady } from '../index';
import {
  careerFacts,
  resumeChangeSets,
  resumeSections,
  resumeVersions,
  resumes,
  users,
} from '../schema';
import { resumeChangeRepository } from './resume-change.repository';
import { resumeRepository } from './resume.repository';
import { careerRepository } from './career.repository';
import { parseWorkResumeV2, toCareerSnapshotImport } from '@/lib/career/workresume-v2';
import { expectedHashForOperation, prepareResumePatch } from '@/lib/resume-patch/operations';
import { resumePatchSchema, type ResumePatchOperation } from '@/lib/resume-patch/schema';
import { createResumeSnapshot, parseResumeSnapshot } from '@/lib/resume-patch/snapshot';
import { resumeChangeService } from '@/lib/resume-patch/service';

const suffix = crypto.randomUUID();
const userId = `patch-user-${suffix}`;
const otherUserId = `patch-other-${suffix}`;
const resumeId = `patch-resume-${suffix}`;

beforeAll(async () => {
  await dbReady;
  await db.insert(users).values([
    { id: userId, username: `patch-${suffix}`, authType: 'password' },
    { id: otherUserId, username: `other-${suffix}`, authType: 'password' },
  ]);
  await db.insert(resumes).values({ id: resumeId, userId, title: 'Patch Test' });
  await db.insert(resumeSections).values({
    id: 'personal',
    resumeId,
    type: 'personal_info',
    title: 'Personal',
    sortOrder: 0,
    content: { fullName: 'Jade', jobTitle: 'Unity Developer', email: '', phone: '', location: '' },
  });
});

function withHash<T extends ResumePatchOperation>(
  snapshot: ReturnType<typeof parseResumeSnapshot>,
  operation: T,
): T {
  return { ...operation, expectedHash: expectedHashForOperation(snapshot, operation) };
}

async function currentSnapshot() {
  const version = await resumeChangeRepository.ensureCurrentVersionOwned(userId, resumeId);
  return { version, snapshot: parseResumeSnapshot(version.snapshot) };
}

async function createHeaderChangeSet(values: { name?: string; title?: string }) {
  const current = await currentSnapshot();
  const operations: ResumePatchOperation[] = [];
  if (values.name) {
    operations.push(withHash(current.snapshot, {
      operationId: `name-${crypto.randomUUID()}`,
      type: 'set_field',
      sectionId: 'personal',
      expectedHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      value: { field: 'fullName', value: values.name },
      reason: 'Polish name',
      evidenceIds: [],
      jdRequirementIds: [],
      confidence: 0.9,
    }));
  }
  if (values.title) {
    operations.push(withHash(current.snapshot, {
      operationId: `title-${crypto.randomUUID()}`,
      type: 'set_field',
      sectionId: 'personal',
      expectedHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      value: { field: 'jobTitle', value: values.title },
      reason: 'Polish title',
      evidenceIds: [],
      jdRequirementIds: [],
      confidence: 0.9,
    }));
  }
  const patch = resumePatchSchema.parse({
    schemaVersion: 1,
    resumeId,
    baseVersionId: current.version.id,
    summary: 'Header changes',
    operations,
    warnings: [],
  });
  const prepared = prepareResumePatch(current.snapshot, patch);
  const changeSet = await resumeChangeRepository.createChangeSetOwned({
    userId,
    resumeId,
    baseVersionId: current.version.id,
    patch,
    prepared,
  });
  expect(changeSet).not.toBeNull();
  return changeSet!;
}

describe('resume change repository', () => {
  it('creates an immutable baseline and blocks cross-tenant reads', async () => {
    const baseline = await resumeChangeRepository.ensureCurrentVersionOwned(userId, resumeId);
    expect(baseline.versionNumber).toBe(1);
    await expect(resumeChangeRepository.findVersionOwned(otherUserId, resumeId, baseline.id)).resolves.toBeNull();
    await expect(resumeChangeRepository.listVersionsOwned(userId, resumeId)).resolves.toHaveLength(1);
  });

  it('applies only the selected operations atomically and creates one new version', async () => {
    const changeSet = await createHeaderChangeSet({ name: 'Jade Xiang', title: 'Unity Client Developer' });
    const selected = changeSet.operations[1].operationId;
    const result = await resumeChangeService.apply({
      userId,
      resumeId,
      changeSetId: changeSet.id,
      operationIds: [selected],
    });
    expect(result.changeSet.status).toBe('partially_applied');
    expect(result.changeSet.operations.map((operation: { result: string }) => operation.result))
      .toEqual(['not_selected', 'applied']);

    const resume = await resumeRepository.findOwnedById(userId, resumeId);
    expect(resume?.sections[0].content).toMatchObject({
      fullName: 'Jade',
      jobTitle: 'Unity Client Developer',
    });
    const versions = await resumeChangeRepository.listVersionsOwned(userId, resumeId);
    expect(versions.map((version: { versionNumber: number }) => version.versionNumber)).toEqual([2, 1]);
  });

  it('restores an old snapshot by creating a new version without deleting history', async () => {
    const versionsBefore = await resumeChangeRepository.listVersionsOwned(userId, resumeId);
    const baseline = versionsBefore.find((version: { versionNumber: number }) => version.versionNumber === 1)!;
    const restored = await resumeChangeService.restore(userId, resumeId, baseline.id);
    expect(restored.resumeVersionId).toBeTruthy();
    const versionsAfter = await resumeChangeRepository.listVersionsOwned(userId, resumeId);
    expect(versionsAfter.map((version: { versionNumber: number }) => version.versionNumber)).toEqual([3, 2, 1]);
    expect(versionsAfter[0].source).toBe('restore');
    const resume = await resumeRepository.findOwnedById(userId, resumeId);
    expect(resume?.sections[0].content).toMatchObject({ fullName: 'Jade', jobTitle: 'Unity Developer' });
    await expect(resumeChangeRepository.listChangeSetsOwned(userId, resumeId)).resolves.not.toHaveLength(0);
  });

  it('reloads approved evidence at apply time and rejects a revoked fact', async () => {
    const parsed = await parseWorkResumeV2(path.resolve('tests/fixtures/workresume-v2'));
    await careerRepository.importSnapshotOwned(toCareerSnapshotImport(userId, parsed, {
      commitSha: 'c'.repeat(40),
      treeSha: 'd'.repeat(40),
      defaultBranch: 'main',
      externalRepositoryId: `sha256:resume-patch-${suffix}`,
      displayName: 'ResumePatch synthetic evidence',
    }));
    const imported = await careerRepository.listFactsOwned(userId);
    const fact = imported.find((candidate) => candidate.evidence.length > 0)!;
    await careerRepository.reviewFactOwned(userId, fact.id, 'approve');
    const approved = await careerRepository.findFactOwned(userId, fact.id);
    const evidenceId = approved!.evidence[0].id;
    const current = await currentSnapshot();
    const operation = withHash(current.snapshot, {
      operationId: `evidence-${crypto.randomUUID()}`,
      type: 'set_field',
      sectionId: 'personal',
      expectedHash: 'sha256:placeholder',
      value: { field: 'jobTitle', value: 'Unity Developer with 20% faster iteration' },
      reason: 'Add a supported quantitative claim',
      evidenceIds: [evidenceId],
      jdRequirementIds: [],
      confidence: 0.8,
    });
    const changeSet = await resumeChangeService.createFromCandidate({
      userId,
      resumeId,
      baseVersionId: current.version.id,
      candidate: {
        schemaVersion: 1,
        resumeId,
        baseVersionId: current.version.id,
        summary: 'Evidence revalidation',
        operations: [operation],
        warnings: [],
      },
    });
    expect(changeSet).not.toBeNull();
    if (!changeSet) throw new Error('Expected evidence-backed change set');
    expect(changeSet.operations[0].evidenceIds).toEqual([evidenceId]);

    const secondResumeId = `patch-resume-reuse-${suffix}`;
    const secondSectionId = `personal-reuse-${suffix}`;
    await db.insert(resumes).values({ id: secondResumeId, userId, title: 'Reuse Evidence Test' });
    await db.insert(resumeSections).values({
      id: secondSectionId,
      resumeId: secondResumeId,
      type: 'personal_info',
      title: 'Personal',
      sortOrder: 0,
      content: { fullName: 'Jade', jobTitle: 'Developer', email: '', phone: '', location: '' },
    });
    const secondVersion = await resumeChangeRepository.ensureCurrentVersionOwned(userId, secondResumeId);
    const secondSnapshot = parseResumeSnapshot(secondVersion.snapshot);
    const reusedOperation = withHash(secondSnapshot, {
      operationId: `evidence-reuse-${crypto.randomUUID()}`,
      type: 'set_field',
      sectionId: secondSectionId,
      expectedHash: 'sha256:placeholder',
      value: { field: 'jobTitle', value: 'Developer with 20% faster iteration' },
      reason: 'Reuse the same approved evidence in another resume',
      evidenceIds: [evidenceId],
      jdRequirementIds: [],
      confidence: 0.8,
    });
    const reusedChangeSet = await resumeChangeService.createFromCandidate({
      userId,
      resumeId: secondResumeId,
      baseVersionId: secondVersion.id,
      candidate: {
        schemaVersion: 1,
        resumeId: secondResumeId,
        baseVersionId: secondVersion.id,
        summary: 'Cross-resume evidence reuse',
        operations: [reusedOperation],
        warnings: [],
      },
    });
    expect(reusedChangeSet).not.toBeNull();
    if (!reusedChangeSet) throw new Error('Expected cross-resume evidence-backed change set');
    expect(reusedChangeSet.operations[0].evidenceIds).toEqual([evidenceId]);

    await db.update(careerFacts).set({ status: 'rejected', updatedAt: new Date() })
      .where(eq(careerFacts.id, fact.id));
    await expect(resumeChangeService.apply({
      userId,
      resumeId,
      changeSetId: changeSet.id,
      operationIds: [operation.operationId],
    })).rejects.toMatchObject({ code: 'EVIDENCE_NOT_APPROVED', status: 422 });

    const stored = await resumeChangeRepository.findChangeSetOwned(userId, resumeId, changeSet.id);
    expect(stored?.status).toBe('validated');
    const unchanged = await resumeRepository.findOwnedById(userId, resumeId);
    expect(unchanged?.sections[0].content).toMatchObject({ jobTitle: 'Unity Developer' });
  });

  it('marks a proposal stale when a manual version is saved after preview', async () => {
    const changeSet = await createHeaderChangeSet({ title: 'Stale Proposal' });
    const resume = await resumeRepository.findOwnedById(userId, resumeId);
    expect(resume).not.toBeNull();
    const manual = createResumeSnapshot({
      ...resume!,
      title: 'Manual title change',
      sections: resume!.sections,
    });
    await resumeChangeRepository.saveManualSnapshotOwned(userId, resumeId, manual);

    await expect(resumeChangeService.apply({
      userId,
      resumeId,
      changeSetId: changeSet.id,
      operationIds: [changeSet.operations[0].operationId],
    })).rejects.toMatchObject({ code: 'STALE_BASE_VERSION', status: 409 });

    const stored = await resumeChangeRepository.findChangeSetOwned(userId, resumeId, changeSet.id);
    expect(stored?.status).toBe('stale');
    const unchanged = await resumeRepository.findOwnedById(userId, resumeId);
    expect(unchanged?.title).toBe('Manual title change');
  });

  it('rolls back live writes, version creation, and change-set status on an injected failure', async () => {
    const changeSet = await createHeaderChangeSet({ name: 'Must Roll Back', title: 'Must Roll Back' });
    const before = await resumeRepository.findOwnedById(userId, resumeId);
    const versionsBefore = await resumeChangeRepository.listVersionsOwned(userId, resumeId);

    await expect(resumeChangeRepository.applyChangeSetOwned({
      userId,
      resumeId,
      changeSetId: changeSet.id,
      operationIds: changeSet.operations.map((operation: { operationId: string }) => operation.operationId),
      afterLiveWriteForTest: () => { throw new Error('injected failure'); },
    })).rejects.toThrow('injected failure');

    const after = await resumeRepository.findOwnedById(userId, resumeId);
    expect(createResumeSnapshot(after!)).toEqual(createResumeSnapshot(before!));
    await expect(resumeChangeRepository.listVersionsOwned(userId, resumeId)).resolves.toHaveLength(versionsBefore.length);
    const stored = await resumeChangeRepository.findChangeSetOwned(userId, resumeId, changeSet.id);
    expect(stored?.status).toBe('validated');
    expect(stored?.operations.every((operation: { result: string }) => operation.result === 'pending')).toBe(true);
  });

  it('does not expose another tenant change set', async () => {
    const ownSet = await db.select().from(resumeChangeSets).limit(1);
    expect(ownSet[0]).toBeTruthy();
    await expect(
      resumeChangeRepository.findChangeSetOwned(otherUserId, resumeId, ownSet[0].id),
    ).resolves.toBeNull();
    const versions = await db.select().from(resumeVersions);
    expect(versions.length).toBeGreaterThan(0);
  });
});
