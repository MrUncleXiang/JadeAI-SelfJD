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

import { GET as getFact, PATCH as updateFact } from './[factId]/route';
import { POST as reviewFact } from './[factId]/review/route';
import { POST as mergeFacts } from './merge/route';
import { GET as listFacts } from './route';

const suffix = crypto.randomUUID().slice(0, 8);
let ownerCookie = '';
let otherCookie = '';

interface FactResponse {
  id: string;
  factType: string;
  canonicalKey: string;
  title: string;
  status: string;
  supersedesFactId: string | null;
  evidence: Array<{
    commitSha: string;
    path: string;
    locator: string;
    contentHash: string;
    parserId: string;
    parserVersion: string;
  }>;
  reviewEvents: Array<{ action: string }>;
}

function cookie(token: string) {
  return `jade_session=${token}`;
}

function request(pathname: string, sessionCookie = ownerCookie) {
  return new NextRequest(`https://resume.test${pathname}`, {
    headers: { cookie: sessionCookie, 'x-request-id': `career-route-${suffix}` },
  });
}

function jsonRequest(pathname: string, body: unknown, sessionCookie = ownerCookie, method = 'POST') {
  return new NextRequest(`https://resume.test${pathname}`, {
    method,
    headers: {
      cookie: sessionCookie,
      origin: 'https://resume.test',
      'content-type': 'application/json',
      'x-request-id': `career-route-${suffix}`,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await dbReady;
  await authRepository.setRegistrationMode('open');
  const owner = await authService.register({
    username: `career_owner_${suffix}`,
    password: 'career owner route password long enough',
  }, { requestId: `career-owner-${suffix}` });
  const other = await authService.register({
    username: `career_other_${suffix}`,
    password: 'career other route password long enough',
  }, { requestId: `career-other-${suffix}` });
  ownerCookie = cookie(owner.token);
  otherCookie = cookie(other.token);

  const parsed = await parseWorkResumeV2(path.resolve('tests/fixtures/workresume-v2'));
  await careerRepository.importSnapshotOwned(toCareerSnapshotImport(owner.user.id, parsed, {
    commitSha: 'e'.repeat(40),
    treeSha: 'f'.repeat(40),
    defaultBranch: 'main',
    externalRepositoryId: `sha256:route-${suffix}`,
    displayName: 'Career route fixture',
  }));
});

describe('career fact routes', () => {
  it('lists only owned facts and returns immutable source provenance', async () => {
    const unauthorized = await listFacts(new NextRequest('https://resume.test/api/career-facts'));
    expect(unauthorized.status).toBe(401);

    const listed = await listFacts(request('/api/career-facts'));
    expect(listed.status).toBe(200);
    expect(listed.headers.get('cache-control')).toBe('no-store');
    const facts = await listed.json() as FactResponse[];
    expect(facts).toHaveLength(4);

    const otherList = await listFacts(request('/api/career-facts', otherCookie));
    await expect(otherList.json()).resolves.toEqual([]);

    const detail = await getFact(request(`/api/career-facts/${facts[0].id}`), {
      params: Promise.resolve({ factId: facts[0].id }),
    });
    expect(detail.status).toBe(200);
    const body = await detail.json() as FactResponse;
    expect(body.evidence[0]).toMatchObject({
      commitSha: 'e'.repeat(40),
      parserId: 'workresume-v2',
      parserVersion: '1',
    });
    expect(body.evidence[0].path).not.toMatch(/^\//);
    expect(body.evidence[0].locator).toMatch(/^\//);
    expect(body.evidence[0].contentHash).toMatch(/^sha256:/);
    expect(body.reviewEvents.map((event) => event.action)).toContain('imported');

    const foreignDetail = await getFact(request(`/api/career-facts/${facts[0].id}`, otherCookie), {
      params: Promise.resolve({ factId: facts[0].id }),
    });
    expect(foreignDetail.status).toBe(404);
  });

  it('rejects invalid list filters with non-cacheable correlated errors', async () => {
    const response = await listFacts(request('/api/career-facts?status=invalid'));
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBe(`career-route-${suffix}`);
    await expect(response.json()).resolves.toMatchObject({
      code: 'INVALID_INPUT',
      requestId: `career-route-${suffix}`,
    });
  });

  it('updates, reviews, versions, and merges facts without mutating reviewed history', async () => {
    const listed = await listFacts(request('/api/career-facts'));
    const facts = await listed.json() as FactResponse[];
    const skill = facts.find((fact) => fact.factType === 'skill')!;

    const updated = await updateFact(
      jsonRequest(`/api/career-facts/${skill.id}`, {
        title: `${skill.title} reviewed`,
        summary: 'Reviewed synthetic skill.',
      }, ownerCookie, 'PATCH'),
      { params: Promise.resolve({ factId: skill.id }) },
    );
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      id: skill.id,
      status: 'draft',
      title: `${skill.title} reviewed`,
    });

    const approved = await reviewFact(
      jsonRequest(`/api/career-facts/${skill.id}/review`, { decision: 'approve', note: 'verified' }),
      { params: Promise.resolve({ factId: skill.id }) },
    );
    expect(approved.status).toBe(200);
    await expect(approved.json()).resolves.toMatchObject({ id: skill.id, status: 'approved' });

    const versioned = await updateFact(
      jsonRequest(`/api/career-facts/${skill.id}`, { summary: 'A new reviewable version.' }, ownerCookie, 'PATCH'),
      { params: Promise.resolve({ factId: skill.id }) },
    );
    const newDraft = await versioned.json() as FactResponse;
    expect(newDraft).toMatchObject({ status: 'draft', supersedesFactId: skill.id });
    expect(newDraft.id).not.toBe(skill.id);

    const oldDetail = await getFact(request(`/api/career-facts/${skill.id}`), {
      params: Promise.resolve({ factId: skill.id }),
    });
    await expect(oldDetail.json()).resolves.toMatchObject({ id: skill.id, status: 'approved' });

    const projects = facts.filter((fact) => fact.factType === 'project');
    const merged = await mergeFacts(jsonRequest('/api/career-facts/merge', {
      factIds: projects.map((fact) => fact.id),
      factType: 'project',
      title: 'Merged project portfolio',
      summary: 'Combined project evidence.',
    }));
    expect(merged.status).toBe(201);
    const mergedDraft = await merged.json() as FactResponse;
    expect(mergedDraft).toMatchObject({ status: 'draft', title: 'Merged project portfolio' });
    expect(mergedDraft.evidence.length).toBeGreaterThanOrEqual(2);

    const approvedMerge = await reviewFact(
      jsonRequest(`/api/career-facts/${mergedDraft.id}/review`, { decision: 'approve' }),
      { params: Promise.resolve({ factId: mergedDraft.id }) },
    );
    expect(approvedMerge.status).toBe(200);
    for (const project of projects) {
      const source = await getFact(request(`/api/career-facts/${project.id}`), {
        params: Promise.resolve({ factId: project.id }),
      });
      await expect(source.json()).resolves.toMatchObject({ status: 'superseded' });
    }
  });

  it('requires trusted origins for state changes', async () => {
    const listed = await listFacts(request('/api/career-facts?status=draft'));
    const facts = await listed.json() as FactResponse[];
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const response = await updateFact(new NextRequest(`https://resume.test/api/career-facts/${facts[0].id}`, {
        method: 'PATCH',
        headers: {
          cookie: ownerCookie,
          origin: 'https://evil.test',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ title: 'Blocked' }),
      }), { params: Promise.resolve({ factId: facts[0].id }) });
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ code: 'UNTRUSTED_ORIGIN' });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
