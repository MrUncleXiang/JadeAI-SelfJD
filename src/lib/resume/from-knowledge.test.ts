import path from 'node:path';

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
});

import { parseWorkResumeV2, toCareerSnapshotImport } from '@/lib/career/workresume-v2';
import { db, dbReady } from '@/lib/db';
import { careerRepository } from '@/lib/db/repositories/career.repository';
import { resumeChangeRepository } from '@/lib/db/repositories/resume-change.repository';
import { resumeRepository } from '@/lib/db/repositories/resume.repository';
import { users } from '@/lib/db/schema';
import { expectedHashForOperation } from '@/lib/resume-patch/operations';
import { resumeChangeService } from '@/lib/resume-patch/service';
import { parseResumeSnapshot } from '@/lib/resume-patch/snapshot';

import { knowledgeResumeService } from './from-knowledge';

const suffix = crypto.randomUUID();
const userId = `knowledge-resume-${suffix}`;

beforeAll(async () => {
  await dbReady;
  await db.insert(users).values({
    id: userId,
    username: userId,
    authType: 'password',
  });
  const parsed = await parseWorkResumeV2(path.resolve('tests/fixtures/workresume-v2'));
  await careerRepository.importSnapshotOwned(toCareerSnapshotImport(userId, parsed, {
    commitSha: '5'.repeat(40),
    treeSha: '6'.repeat(40),
    defaultBranch: 'main',
    externalRepositoryId: `sha256:knowledge-resume-${suffix}`,
    displayName: 'Knowledge resume fixture',
  }));
});

describe('knowledge resume service [KB-002]', () => {
  it('requires approved facts and leaves no empty resume behind on rejection', async () => {
    const before = await resumeRepository.findAllByUserId(userId);
    await expect(knowledgeResumeService.create({ userId })).rejects.toMatchObject({
      code: 'NO_APPROVED_FACTS',
      status: 409,
    });
    await expect(resumeRepository.findAllByUserId(userId)).resolves.toHaveLength(before.length);
  });

  it('creates a baseline plus an evidence-backed, reviewable change set', async () => {
    const drafts = await careerRepository.listFactsOwned(userId, { status: 'draft' });
    const approvedFact = drafts.find((fact) => fact.evidence.length > 0)!;
    await careerRepository.reviewFactOwned(userId, approvedFact.id, 'approve');
    const evidenceId = approvedFact.evidence[0].id;

    const propose = vi.spyOn(resumeChangeService, 'propose').mockImplementation(async (input) => {
      const version = await resumeChangeRepository.ensureCurrentVersionOwned(input.userId, input.resumeId);
      const snapshot = parseResumeSnapshot(version.snapshot);
      const summary = snapshot.sections.find((section) => section.type === 'summary');
      if (!summary) throw new Error('Expected summary section');
      const operation = {
        operationId: `knowledge-summary-${suffix}`,
        type: 'set_field' as const,
        sectionId: summary.id,
        expectedHash: '',
        value: { field: 'text', value: approvedFact.summary },
        reason: 'Create a summary from an approved career fact.',
        evidenceIds: [evidenceId],
        jdRequirementIds: [],
        confidence: 1,
      };
      operation.expectedHash = expectedHashForOperation(snapshot, operation);
      return resumeChangeService.createFromCandidate({
        userId: input.userId,
        resumeId: input.resumeId,
        baseVersionId: version.id,
        candidate: {
          schemaVersion: 1,
          resumeId: input.resumeId,
          baseVersionId: version.id,
          summary: 'Generate a resume from approved knowledge.',
          operations: [operation],
          warnings: [],
        },
        requestId: input.requestId,
      });
    });

    try {
      const created = await knowledgeResumeService.create({
        userId,
        targetRole: 'Unity Client Engineer',
        title: 'Unity 定向简历',
        template: 'modern',
        language: 'zh',
        requestId: `knowledge-resume-request-${suffix}`,
      });

      expect(created).toMatchObject({ title: 'Unity 定向简历', operationCount: 1 });
      expect(propose).toHaveBeenCalledWith(expect.objectContaining({
        userId,
        resumeId: created.resumeId,
        instruction: expect.stringContaining('目标岗位偏好：Unity Client Engineer'),
      }));
      const baseline = await resumeRepository.findOwnedById(userId, created.resumeId);
      expect(baseline).toMatchObject({ template: 'modern', language: 'zh' });
      expect(baseline?.sections.find((section: { type: string }) => section.type === 'summary')?.content)
        .toEqual({ text: '' });
      const changeSet = await resumeChangeRepository.findChangeSetOwned(
        userId,
        created.resumeId,
        created.changeSetId,
      );
      expect(changeSet).toMatchObject({ status: 'validated' });
      expect(changeSet?.operations).toEqual([
        expect.objectContaining({ evidenceIds: [evidenceId], result: 'pending' }),
      ]);
    } finally {
      propose.mockRestore();
    }
  });
});
