import path from 'node:path';

import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
  process.env.REGISTRATION_MODE = 'open';
  process.env.SEED_DEMO_DATA = 'false';
});

import { authService } from '@/lib/auth/service';
import { parseWorkResumeV2, toCareerSnapshotImport } from '@/lib/career/workresume-v2';
import { dbReady } from '@/lib/db';
import { authRepository } from '@/lib/db/repositories/auth.repository';
import { careerRepository } from '@/lib/db/repositories/career.repository';

import { POST as batchReview } from './route';

const suffix = crypto.randomUUID().slice(0, 8);
let ownerUserId = '';
let otherUserId = '';
let ownerCookie = '';

function request(body: unknown, origin = 'https://resume.test') {
  return new NextRequest('https://resume.test/api/career-facts/review', {
    method: 'POST',
    headers: {
      cookie: ownerCookie,
      origin,
      'content-type': 'application/json',
      'x-request-id': `career-batch-${suffix}`,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await dbReady;
  await authRepository.setRegistrationMode('open');
  const owner = await authService.register({
    username: `career_batch_owner_${suffix}`,
    password: 'career batch owner password long enough',
  }, { requestId: `career-batch-owner-${suffix}` });
  const other = await authService.register({
    username: `career_batch_other_${suffix}`,
    password: 'career batch other password long enough',
  }, { requestId: `career-batch-other-${suffix}` });
  ownerUserId = owner.user.id;
  otherUserId = other.user.id;
  ownerCookie = `jade_session=${owner.token}`;

  const parsed = await parseWorkResumeV2(path.resolve('tests/fixtures/workresume-v2'));
  await careerRepository.importSnapshotOwned(toCareerSnapshotImport(ownerUserId, parsed, {
    commitSha: '1'.repeat(40),
    treeSha: '2'.repeat(40),
    defaultBranch: 'main',
    externalRepositoryId: `sha256:batch-owner-${suffix}`,
    displayName: 'Batch owner fixture',
  }));
  await careerRepository.importSnapshotOwned(toCareerSnapshotImport(otherUserId, parsed, {
    commitSha: '3'.repeat(40),
    treeSha: '4'.repeat(40),
    defaultBranch: 'main',
    externalRepositoryId: `sha256:batch-other-${suffix}`,
    displayName: 'Batch other fixture',
  }));
});

describe('POST /api/career-facts/review [KB-002]', () => {
  it('reviews multiple owned drafts atomically and rejects cross-tenant batches', async () => {
    const ownerFacts = await careerRepository.listFactsOwned(ownerUserId);
    const otherFacts = await careerRepository.listFactsOwned(otherUserId);

    const approved = await batchReview(request({
      factIds: ownerFacts.slice(0, 2).map((fact) => fact.id),
      decision: 'approve',
    }));
    expect(approved.status).toBe(200);
    await expect(approved.json()).resolves.toSatisfy((facts: Array<{ status: string }>) => (
      facts.length === 2 && facts.every((fact) => fact.status === 'approved')
    ));

    const stillDraftId = ownerFacts[2].id;
    const blocked = await batchReview(request({
      factIds: [stillDraftId, otherFacts[0].id],
      decision: 'reject',
    }));
    expect(blocked.status).toBe(409);
    expect((await careerRepository.findFactOwned(ownerUserId, stillDraftId))?.status).toBe('draft');
    expect((await careerRepository.findFactOwned(otherUserId, otherFacts[0].id))?.status).toBe('draft');

    const rejected = await batchReview(request({
      factIds: ownerFacts.slice(2).map((fact) => fact.id),
      decision: 'reject',
      note: 'Not selected for reuse',
    }));
    expect(rejected.status).toBe(200);
    await expect(rejected.json()).resolves.toSatisfy((facts: Array<{ status: string }>) => (
      facts.length === 2 && facts.every((fact) => fact.status === 'rejected')
    ));
  });

  it('requires a trusted origin', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const response = await batchReview(request({ factIds: ['fact-id'], decision: 'approve' }, 'https://evil.test'));
      expect(response.status).toBe(403);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
