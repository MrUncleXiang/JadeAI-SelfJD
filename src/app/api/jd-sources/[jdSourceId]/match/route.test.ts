import path from 'node:path';

import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
  process.env.REGISTRATION_MODE = 'open';
  process.env.SEED_DEMO_DATA = 'false';
});

import { parseWorkResumeV2, toCareerSnapshotImport } from '@/lib/career/workresume-v2';
import { authService } from '@/lib/auth/service';
import { dbReady } from '@/lib/db';
import { authRepository } from '@/lib/db/repositories/auth.repository';
import { careerRepository } from '@/lib/db/repositories/career.repository';
import { jdRepository } from '@/lib/db/repositories/jd.repository';

import { GET, POST } from './route';

const suffix = crypto.randomUUID().slice(0, 8);
let userId = '';
let confirmedJdId = '';
let draftJdId = '';
let cookie = '';

function request(jdSourceId: string, method: 'GET' | 'POST' = 'POST') {
  return new NextRequest(`https://resume.test/api/jd-sources/${jdSourceId}/match`, {
    method,
    headers: {
      cookie,
      origin: 'https://resume.test',
      'x-request-id': `match-route-${suffix}`,
    },
  });
}

beforeAll(async () => {
  await dbReady;
  await authRepository.setRegistrationMode('open');
  const registered = await authService.register({
    username: `match_route_${suffix}`,
    password: 'match route password long enough',
  }, { requestId: `match-route-register-${suffix}` });
  userId = registered.user.id;
  cookie = `jade_session=${registered.token}`;

  const parsed = await parseWorkResumeV2(path.resolve('tests/fixtures/workresume-v2'));
  await careerRepository.importSnapshotOwned(toCareerSnapshotImport(userId, parsed, {
    commitSha: '1'.repeat(40),
    treeSha: '2'.repeat(40),
    defaultBranch: 'main',
    externalRepositoryId: `sha256:match-route-${suffix}`,
    displayName: 'Match route fixture',
  }));
  const drafts = await careerRepository.listFactsOwned(userId, { status: 'draft' });
  const approved = drafts.find((fact) => fact.evidence.length > 0)!;
  await careerRepository.reviewFactOwned(userId, approved.id, 'approve');

  const created = await jdRepository.createTextSourceOwned({
    userId,
    title: 'Match role',
    rawText: 'Need Unity experience',
    normalizedText: 'Need Unity experience',
    contentHash: `sha256:match-confirmed-${suffix}`,
    sizeBytes: 21,
  });
  const reviewed = await jdRepository.replaceReviewOwned(userId, created.source.id, {
    title: 'Match role',
    company: 'Studio',
    jobTitle: 'Unity Engineer',
    location: 'Remote',
    parserId: 'test',
    parserVersion: '1',
    requirements: [{
      requirementType: 'hard_skill',
      text: 'Unity production experience',
      normalizedTerm: 'Unity',
      aliases: [],
      priority: 'required',
      importance: 1,
      sourceLocator: { start: 0, end: 5 },
      sortOrder: 0,
    }],
  });
  const confirmed = await jdRepository.confirmOwned(userId, reviewed!.id);
  confirmedJdId = confirmed!.id;

  const draft = await jdRepository.createTextSourceOwned({
    userId,
    title: 'Draft role',
    rawText: 'draft',
    normalizedText: 'draft',
    contentHash: `sha256:match-draft-${suffix}`,
    sizeBytes: 5,
  });
  draftJdId = draft.source.id;
});

describe('POST /api/jd-sources/{jdSourceId}/match [JD-003]', () => {
  it('returns a match matrix for confirmed JD and approved facts', async () => {
    const response = await POST(
      request(confirmedJdId, 'POST'),
      { params: Promise.resolve({ jdSourceId: confirmedJdId }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.jdSourceId).toBe(confirmedJdId);
    expect(body.summary.total).toBe(1);
    expect(body.rows[0]).toMatchObject({
      requirementId: expect.any(String),
      level: expect.stringMatching(/^(strong|partial|gap|conflict)$/),
      rationale: expect.any(String),
    });
    expect(Array.isArray(body.gaps)).toBe(true);
    expect(Array.isArray(body.conflicts)).toBe(true);
  });

  it('rejects unconfirmed JD and anonymous callers', async () => {
    const unconfirmed = await POST(
      request(draftJdId, 'POST'),
      { params: Promise.resolve({ jdSourceId: draftJdId }) },
    );
    expect(unconfirmed.status).toBe(409);
    await expect(unconfirmed.json()).resolves.toMatchObject({ code: 'JD_SOURCE_NOT_CONFIRMED' });

    const anonymous = await GET(
      new NextRequest(`https://resume.test/api/jd-sources/${confirmedJdId}/match`, {
        headers: { origin: 'https://resume.test' },
      }),
      { params: Promise.resolve({ jdSourceId: confirmedJdId }) },
    );
    expect(anonymous.status).toBe(401);
  });
});
