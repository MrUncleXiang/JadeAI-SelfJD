import path from 'node:path';

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
});

import { parseWorkResumeV2, toCareerSnapshotImport } from '@/lib/career/workresume-v2';
import { db, dbReady } from '@/lib/db';
import { careerRepository } from '@/lib/db/repositories/career.repository';
import { jdRepository } from '@/lib/db/repositories/jd.repository';
import { resumeChangeRepository } from '@/lib/db/repositories/resume-change.repository';
import { resumeRepository } from '@/lib/db/repositories/resume.repository';
import { users } from '@/lib/db/schema';
import { resumeChangeService } from '@/lib/resume-patch/service';
import { canonicalJson, parseResumeSnapshot } from '@/lib/resume-patch/snapshot';

import { targetedDraftService, targetedDraftToResumePatch } from './targeted-draft';
import { targetedResumeService } from './targeted';

const suffix = crypto.randomUUID();
const userId = `targeted-resume-${suffix}`;
const otherUserId = `targeted-resume-other-${suffix}`;
let evidenceId = '';
let jdSourceId = '';
let jdRequirementId = '';
let draftJdSourceId = '';
let baseResumeId = '';
let otherJdSourceId = '';

beforeAll(async () => {
  await dbReady;
  await db.insert(users).values([
    { id: userId, username: userId, authType: 'password' },
    { id: otherUserId, username: otherUserId, authType: 'password' },
  ]);

  const parsed = await parseWorkResumeV2(path.resolve('tests/fixtures/workresume-v2'));
  await careerRepository.importSnapshotOwned(toCareerSnapshotImport(userId, parsed, {
    commitSha: '7'.repeat(40),
    treeSha: '8'.repeat(40),
    defaultBranch: 'main',
    externalRepositoryId: `sha256:targeted-resume-${suffix}`,
    displayName: 'Targeted resume fixture',
  }));
  const drafts = await careerRepository.listFactsOwned(userId, { status: 'draft' });
  const approvedFact = drafts.find((fact) => fact.evidence.length > 0)!;
  await careerRepository.reviewFactOwned(userId, approvedFact.id, 'approve');
  evidenceId = approvedFact.evidence[0].id;

  const createdJd = await jdRepository.createTextSourceOwned({
    userId,
    title: 'Unity Client Engineer',
    rawText: 'Build and optimize Unity game clients.',
    normalizedText: 'Build and optimize Unity game clients.',
    contentHash: `sha256:confirmed-jd-${suffix}`,
    sizeBytes: 38,
  });
  const reviewedJd = await jdRepository.replaceReviewOwned(userId, createdJd.source.id, {
    title: 'Unity Client Engineer',
    company: 'Example Studio',
    jobTitle: 'Unity Client Engineer',
    location: 'Shenzhen',
    parserId: 'test',
    parserVersion: '1',
    requirements: [{
      requirementType: 'hard_skill',
      text: 'Production Unity development experience',
      normalizedTerm: 'Unity',
      aliases: ['Unity3D'],
      priority: 'required',
      importance: 1,
      sourceLocator: { start: 0, end: 5 },
      sortOrder: 0,
    }],
  });
  const confirmedJd = await jdRepository.confirmOwned(userId, reviewedJd!.id);
  jdSourceId = confirmedJd!.id;
  jdRequirementId = confirmedJd!.requirements[0].id;

  const draftJd = await jdRepository.createTextSourceOwned({
    userId,
    title: 'Unconfirmed role',
    rawText: 'Unconfirmed role text',
    normalizedText: 'Unconfirmed role text',
    contentHash: `sha256:draft-jd-${suffix}`,
    sizeBytes: 21,
  });
  draftJdSourceId = draftJd.source.id;

  const otherJd = await jdRepository.createTextSourceOwned({
    userId: otherUserId,
    title: 'Other confirmed role',
    rawText: 'Other confirmed role text',
    normalizedText: 'Other confirmed role text',
    contentHash: `sha256:other-jd-${suffix}`,
    sizeBytes: 25,
  });
  const otherReviewed = await jdRepository.replaceReviewOwned(otherUserId, otherJd.source.id, {
    title: 'Other confirmed role',
    company: '',
    jobTitle: 'Other Engineer',
    location: '',
    parserId: 'test',
    parserVersion: '1',
    requirements: [{
      requirementType: 'hard_skill',
      text: 'A confirmed requirement',
      normalizedTerm: 'requirement',
      aliases: [],
      priority: 'required',
      importance: 1,
      sourceLocator: {},
      sortOrder: 0,
    }],
  });
  otherJdSourceId = (await jdRepository.confirmOwned(otherUserId, otherReviewed!.id))!.id;

  const base = await resumeRepository.createOwned(userId, {
    title: 'Baseline Resume',
    template: 'modern',
    language: 'en',
  });
  baseResumeId = base!.id;
  await resumeRepository.createSectionOwned(userId, {
    resumeId: baseResumeId,
    type: 'summary',
    title: 'Summary',
    sortOrder: 0,
    content: { text: 'Original baseline summary.' },
  });
  await resumeChangeRepository.ensureCurrentVersionOwned(userId, baseResumeId);
});

describe('targeted resume service [JD-003, JD-004]', () => {
  it('clones a base resume, creates a doubly-referenced change set, and leaves the base unchanged', async () => {
    const baseBefore = await resumeRepository.findOwnedById(userId, baseResumeId);
    const baseVersionBefore = await resumeChangeRepository.findLatestVersionOwned(userId, baseResumeId);
    const propose = vi.spyOn(targetedDraftService, 'propose').mockImplementation(async (input) => {
      expect(input.jdContext).toMatchObject({ id: jdSourceId });
      expect(input.policy?.allowedJdRequirementIds?.has(jdRequirementId)).toBe(true);
      const version = await resumeChangeRepository.ensureCurrentVersionOwned(input.userId, input.resumeId);
      const snapshot = parseResumeSnapshot(version.snapshot);
      let nextId = 0;
      const patch = targetedDraftToResumePatch({
        snapshot,
        baseVersionId: version.id,
        idFactory: () => `generated-${++nextId}-${suffix}`,
        draft: {
          summary: {
            text: 'Evidence-backed Unity client engineer.',
            evidenceIds: [evidenceId],
            jdRequirementIds: [jdRequirementId],
          },
          skillCategories: [{
            name: 'Client Development',
            skills: ['Unity'],
            evidenceIds: [evidenceId],
            jdRequirementIds: [jdRequirementId],
          }],
          projects: [{
            name: 'Approved Unity Project',
            description: 'Built a Unity client from approved project evidence.',
            technologies: ['Unity'],
            highlights: [],
            evidenceIds: [evidenceId],
            jdRequirementIds: [jdRequirementId],
          }],
          warnings: [],
        },
      });
      return resumeChangeService.createFromCandidate({
        userId: input.userId,
        resumeId: input.resumeId,
        baseVersionId: version.id,
        candidate: patch,
        requestId: input.requestId,
        policy: input.policy,
      });
    });

    try {
      const created = await targetedResumeService.create({
        userId,
        jdSourceId,
        baseResumeId,
        title: 'Unity Targeted Resume',
        requestId: `targeted-request-${suffix}`,
      });
      expect(created).toMatchObject({
        baseResumeId,
        jdSourceId,
        title: 'Unity Targeted Resume',
        operationCount: 3,
      });

      const target = await resumeRepository.findOwnedById(userId, created.resumeId);
      expect(target).toMatchObject({
        kind: 'targeted',
        parentResumeId: baseResumeId,
        targetJdSourceId: jdSourceId,
        template: 'modern',
        language: 'en',
      });
      const changeSet = await resumeChangeRepository.findChangeSetOwned(
        userId,
        created.resumeId,
        created.changeSetId,
      );
      expect(changeSet?.operations).toHaveLength(3);
      expect(changeSet?.operations).toEqual(expect.arrayContaining([
        expect.objectContaining({
          evidenceIds: [evidenceId],
          jdRequirementIds: [jdRequirementId],
        }),
      ]));

      await resumeChangeService.apply({
        userId,
        resumeId: created.resumeId,
        changeSetId: created.changeSetId,
        operationIds: changeSet!.operations.map((operation) => operation.operationId),
      });
      const appliedTarget = await resumeRepository.findOwnedById(userId, created.resumeId);
      expect(appliedTarget?.sections.find((section: { type: string }) => section.type === 'summary')?.content).toEqual({
        text: 'Evidence-backed Unity client engineer.',
      });
      expect(appliedTarget?.sections.find((section: { type: string }) => section.type === 'skills')?.content)
        .toMatchObject({ categories: [expect.objectContaining({ name: 'Client Development', skills: ['Unity'] })] });
      expect(appliedTarget?.sections.find((section: { type: string }) => section.type === 'projects')?.content)
        .toMatchObject({ items: [expect.objectContaining({ name: 'Approved Unity Project' })] });

      const baseAfter = await resumeRepository.findOwnedById(userId, baseResumeId);
      const baseVersionAfter = await resumeChangeRepository.findLatestVersionOwned(userId, baseResumeId);
      expect(canonicalJson(baseAfter)).toBe(canonicalJson(baseBefore));
      expect(baseVersionAfter?.id).toBe(baseVersionBefore?.id);
    } finally {
      propose.mockRestore();
    }
  });

  it('rejects an unconfirmed JD without creating a resume', async () => {
    const before = await resumeRepository.findAllByUserId(userId);
    await expect(targetedResumeService.create({
      userId,
      jdSourceId: draftJdSourceId,
    })).rejects.toMatchObject({ code: 'JD_SOURCE_NOT_CONFIRMED', status: 409 });
    await expect(resumeRepository.findAllByUserId(userId)).resolves.toHaveLength(before.length);
  });

  it('rejects a base resume owned by another tenant', async () => {
    const other = await resumeRepository.createOwned(otherUserId, { title: 'Other tenant resume' });
    await expect(targetedResumeService.create({
      userId,
      jdSourceId,
      baseResumeId: other!.id,
    })).rejects.toMatchObject({ code: 'BASE_RESUME_NOT_FOUND', status: 404 });
  });

  it('requires at least one approved fact and leaves no resume behind', async () => {
    const before = await resumeRepository.findAllByUserId(otherUserId);
    await expect(targetedResumeService.create({
      userId: otherUserId,
      jdSourceId: otherJdSourceId,
    })).rejects.toMatchObject({ code: 'NO_APPROVED_FACTS', status: 409 });
    await expect(resumeRepository.findAllByUserId(otherUserId)).resolves.toHaveLength(before.length);
  });

  it('deletes a newly-created targeted resume if proposal generation fails', async () => {
    const before = await resumeRepository.findAllByUserId(userId);
    const propose = vi.spyOn(targetedDraftService, 'propose')
      .mockRejectedValueOnce(new Error('provider failed'));
    try {
      await expect(targetedResumeService.create({
        userId,
        jdSourceId,
        title: 'Must be cleaned up',
      })).rejects.toThrow('provider failed');
      await expect(resumeRepository.findAllByUserId(userId)).resolves.toHaveLength(before.length);
    } finally {
      propose.mockRestore();
    }
  });

  it('deletes a partially-created empty target if section creation fails', async () => {
    const before = await resumeRepository.findAllByUserId(userId);
    const createSection = vi.spyOn(resumeRepository, 'createSectionOwned')
      .mockRejectedValueOnce(new Error('section creation failed'));
    try {
      await expect(targetedResumeService.create({
        userId,
        jdSourceId,
        title: 'Partial target must be cleaned up',
      })).rejects.toThrow('section creation failed');
      await expect(resumeRepository.findAllByUserId(userId)).resolves.toHaveLength(before.length);
    } finally {
      createSection.mockRestore();
    }
  });
});
