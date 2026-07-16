import path from 'node:path';

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
});

import { careerFactContentHash } from '@/lib/career/normalize';
import {
  parseWorkResumeV2,
  toCareerSnapshotImport,
} from '@/lib/career/workresume-v2';
import { db, dbReady } from '../index';
import {
  careerFactEvidence,
  careerFacts,
  factReviewEvents,
  sourceDocuments,
  sourceRepositories,
  sourceSnapshots,
  users,
} from '../schema';
import { careerRepository } from './career.repository';

const suffix = crypto.randomUUID();
const userId = `career-user-${suffix}`;
const otherUserId = `career-other-${suffix}`;
let importedFactIds: string[] = [];

beforeAll(async () => {
  await dbReady;
  await db.insert(users).values([
    { id: userId, username: `career-${suffix}`, authType: 'password' },
    { id: otherUserId, username: `career-other-${suffix}`, authType: 'password' },
  ]);
});

describe('career knowledge repository', () => {
  it('imports the same WorkResume commit idempotently with complete provenance', async () => {
    const parsed = await parseWorkResumeV2(path.resolve('tests/fixtures/workresume-v2'));
    const input = toCareerSnapshotImport(userId, parsed, {
      commitSha: 'a'.repeat(40),
      treeSha: 'b'.repeat(40),
      defaultBranch: 'main',
      externalRepositoryId: 'sha256:fixture-repository',
      displayName: 'Synthetic WorkResume',
    });
    const first = await careerRepository.importSnapshotOwned(input);
    const second = await careerRepository.importSnapshotOwned(input);
    expect(first).toMatchObject({
      alreadyImported: false,
      documentsCreated: 7,
      factsCreated: 4,
      evidenceCreated: 5,
      claimsCreated: 10,
    });
    expect(second).toMatchObject({ alreadyImported: true, documentsCreated: 0, factsCreated: 0 });

    await expect(db.select().from(sourceRepositories)).resolves.toHaveLength(1);
    await expect(db.select().from(sourceSnapshots)).resolves.toHaveLength(1);
    await expect(db.select().from(sourceDocuments)).resolves.toHaveLength(7);
    const facts = await careerRepository.listFactsOwned(userId);
    importedFactIds = facts.map((fact) => fact.id);
    expect(facts).toHaveLength(4);
    expect(facts.every((fact) => fact.status === 'draft')).toBe(true);
    expect(facts.flatMap((fact) => fact.evidence)).toHaveLength(5);
    expect(facts.every((fact) => fact.evidence.every((evidence) => evidence.commitSha === 'a'.repeat(40)))).toBe(true);
    await expect(db.select().from(factReviewEvents)).resolves.toHaveLength(4);
  });

  it('enforces tenant isolation for list, detail, edit, and review', async () => {
    const factId = importedFactIds[0];
    await expect(careerRepository.listFactsOwned(otherUserId)).resolves.toEqual([]);
    await expect(careerRepository.findFactOwned(otherUserId, factId)).resolves.toBeNull();
    await expect(careerRepository.reviewFactOwned(otherUserId, factId, 'approve'))
      .rejects.toMatchObject({ code: 'FACT_NOT_FOUND' });
  });

  it('allows only approved facts in the reusable policy and keeps forbidden claims blocking', async () => {
    const facts = await careerRepository.listFactsOwned(userId);
    const approved = facts.find((fact) => fact.canonicalKey === 'skill:distributed-systems')!;
    const rejected = facts.find((fact) => fact.canonicalKey === 'skill:observability')!;
    await careerRepository.reviewFactOwned(userId, approved.id, 'approve', 'verified');
    await careerRepository.reviewFactOwned(userId, rejected.id, 'reject', 'not for use');

    const policy = await careerRepository.loadPolicyOwned(userId);
    expect(policy.facts.map((fact) => fact.id)).toEqual([approved.id]);
    expect([...policy.approvedEvidenceIds]).toEqual(approved.evidence.map((evidence) => evidence.id));
    expect(policy.facts[0].allowedClaims).toContain('Can design idempotent distributed workflows.');
    expect(policy.forbiddenClaims).toContain('Created the OpenTelemetry standard.');
  });

  it('edits an approved fact as a new draft and supersedes the old version only after approval', async () => {
    const facts = await careerRepository.listFactsOwned(userId);
    const approved = facts.find((fact) => fact.canonicalKey === 'skill:distributed-systems')!;
    const structuredData = { ...approved.structuredData, reviewMarker: 'edited' };
    const title = `${approved.title} (reviewed)`;
    const contentHash = careerFactContentHash({
      factType: approved.factType,
      canonicalKey: approved.canonicalKey,
      title,
      summary: approved.summary,
      structuredData,
    });
    const draft = await careerRepository.editFactOwned(userId, approved.id, {
      title,
      summary: approved.summary,
      structuredData,
      contentHash,
    });
    expect(draft).toMatchObject({ status: 'draft', supersedesFactId: approved.id });
    expect((await careerRepository.findFactOwned(userId, approved.id))?.status).toBe('approved');
    expect((await careerRepository.findFactOwned(userId, draft.id))?.evidence).toHaveLength(approved.evidence.length);

    await careerRepository.reviewFactOwned(userId, draft.id, 'approve');
    expect((await careerRepository.findFactOwned(userId, approved.id))?.status).toBe('superseded');
    expect((await careerRepository.findFactOwned(userId, approved.id))?.supersededByFactId).toBe(draft.id);
    expect((await careerRepository.loadPolicyOwned(userId)).facts.map((fact) => fact.id)).toEqual([draft.id]);
    await expect(careerRepository.editFactOwned(userId, draft.id, {
      title: approved.title,
      summary: approved.summary,
      structuredData: approved.structuredData,
      contentHash: approved.contentHash,
    })).rejects.toMatchObject({ code: 'FACT_CONTENT_CONFLICT' });
    await expect(careerRepository.editFactOwned(userId, approved.id, {
      title: approved.title,
      summary: approved.summary,
      structuredData: approved.structuredData,
      contentHash: approved.contentHash,
    })).rejects.toMatchObject({ code: 'INVALID_FACT_STATE' });
  });

  it('creates a reviewable merged draft and preserves every distinct evidence link', async () => {
    const facts = await careerRepository.listFactsOwned(userId);
    const projectFacts = facts.filter((fact) => fact.factType === 'project');
    const title = 'Merged project portfolio';
    const summary = 'Combined synthetic project facts.';
    const structuredData = { mergedFactIds: projectFacts.map((fact) => fact.id).sort() };
    const canonicalKey = `merge:${suffix}`;
    const rejected = facts.find((fact) => fact.status === 'rejected')!;
    const rejectedCanonicalKey = `merge-rejected:${suffix}`;
    await expect(careerRepository.mergeFactsOwned(userId, [projectFacts[0].id, rejected.id], {
      factType: 'project', canonicalKey: rejectedCanonicalKey, title, summary, structuredData,
      contentHash: careerFactContentHash({
        factType: 'project', canonicalKey: rejectedCanonicalKey, title, summary, structuredData,
      }),
    })).rejects.toMatchObject({ code: 'INVALID_MERGE' });
    const merged = await careerRepository.mergeFactsOwned(userId, projectFacts.map((fact) => fact.id), {
      factType: 'project', canonicalKey, title, summary, structuredData,
      contentHash: careerFactContentHash({ factType: 'project', canonicalKey, title, summary, structuredData }),
    });
    const detail = await careerRepository.findFactOwned(userId, merged.id);
    expect(detail).toMatchObject({ status: 'draft', title });
    expect(detail?.evidence).toHaveLength(projectFacts.flatMap((fact) => fact.evidence).length);
    await careerRepository.reviewFactOwned(userId, merged.id, 'approve');
    for (const source of projectFacts) {
      expect((await careerRepository.findFactOwned(userId, source.id))?.status).toBe('superseded');
    }
  });

  it('never exposes evidence through a different tenant even when IDs are known', async () => {
    const evidenceRows = await db.select().from(careerFactEvidence);
    expect(evidenceRows.length).toBeGreaterThan(0);
    await expect(careerRepository.findFactOwned(otherUserId, evidenceRows[0].careerFactId)).resolves.toBeNull();
    const allFacts = await db.select().from(careerFacts);
    expect(allFacts.every((fact: typeof careerFacts.$inferSelect) => fact.userId === userId)).toBe(true);
  });
});
