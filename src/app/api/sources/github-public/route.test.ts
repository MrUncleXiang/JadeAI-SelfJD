import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
  process.env.REGISTRATION_MODE = 'open';
  process.env.SEED_DEMO_DATA = 'false';
});

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  importRepository: vi.fn(),
}));

vi.mock('@/lib/github/public-source', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/github/public-source')>();
  return {
    ...actual,
    publicGitHubSourceService: {
      list: mocks.list,
      importRepository: mocks.importRepository,
    },
  };
});

import { NextRequest } from 'next/server';

import { authService } from '@/lib/auth/service';
import { dbReady } from '@/lib/db';
import { authRepository } from '@/lib/db/repositories/auth.repository';
import { PublicGitHubSourceError } from '@/lib/github/public-source';

import { GET, POST } from './route';

const suffix = crypto.randomUUID().slice(0, 8);
let ownerCookie = '';

function getRequest(cookie = ownerCookie) {
  return new NextRequest('https://resume.test/api/sources/github-public', {
    headers: { cookie, 'x-request-id': `github-public-get-${suffix}` },
  });
}

function postRequest(
  body: unknown,
  cookie = ownerCookie,
  origin = 'https://resume.test',
) {
  return new NextRequest('https://resume.test/api/sources/github-public', {
    method: 'POST',
    headers: {
      cookie,
      origin,
      'content-type': 'application/json',
      'x-request-id': `github-public-post-${suffix}`,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await dbReady;
  await authRepository.setRegistrationMode('open');
  const owner = await authService.register({
    username: `github_public_route_${suffix}`,
    password: 'Public GitHub route password long enough',
  }, { requestId: `github-public-route-owner-${suffix}` });
  ownerCookie = `jade_session=${owner.token}`;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([{
    id: 'source-1',
    kind: 'github-public',
    fullName: 'alice/career-facts',
    repositoryUrl: 'https://github.com/alice/career-facts',
    defaultBranch: 'main',
    lastRevision: 'a'.repeat(40),
    lastImportedAt: '2026-07-17T10:00:00.000Z',
  }]);
  mocks.importRepository.mockResolvedValue({
    source: {
      id: 'source-1',
      kind: 'github-public',
      fullName: 'alice/career-facts',
      repositoryUrl: 'https://github.com/alice/career-facts',
      defaultBranch: 'main',
      lastRevision: 'a'.repeat(40),
      lastImportedAt: '2026-07-17T10:00:00.000Z',
    },
    alreadyImported: false,
    fetchedBlobs: 7,
    factsCreated: 4,
    factsReused: 0,
  });
});

describe('public GitHub source route', () => {
  it('requires authentication and a trusted origin', async () => {
    expect((await GET(getRequest(''))).status).toBe(401);
    expect((await POST(postRequest({
      repositoryUrl: 'https://github.com/alice/career-facts',
    }, ownerCookie, 'https://evil.test'))).status).toBe(403);
    expect(mocks.importRepository).not.toHaveBeenCalled();
  });

  it('lists tenant-scoped sources and imports a canonical URL', async () => {
    const listed = await GET(getRequest());
    expect(listed.status).toBe(200);
    expect(listed.headers.get('cache-control')).toBe('no-store');
    await expect(listed.json()).resolves.toHaveLength(1);

    const imported = await POST(postRequest({
      repositoryUrl: 'https://github.com/alice/career-facts',
    }));
    expect(imported.status).toBe(201);
    expect(imported.headers.get('cache-control')).toBe('no-store');
    expect(imported.headers.get('x-request-id')).toBe(`github-public-post-${suffix}`);
    expect(mocks.importRepository).toHaveBeenCalledWith(
      expect.objectContaining({ userId: expect.any(String) }),
      'https://github.com/alice/career-facts',
    );
  });

  it('bounds and validates JSON before calling the service', async () => {
    expect((await POST(postRequest({ repositoryUrl: 'x', unexpected: true }))).status).toBe(400);
    expect((await POST(new NextRequest('https://resume.test/api/sources/github-public', {
      method: 'POST',
      headers: {
        cookie: ownerCookie,
        origin: 'https://resume.test',
        'content-type': 'text/plain',
      },
      body: 'not-json',
    }))).status).toBe(415);
    expect(mocks.importRepository).not.toHaveBeenCalled();
  });

  it('returns stable source errors without echoing the submitted URL', async () => {
    mocks.importRepository.mockRejectedValueOnce(
      new PublicGitHubSourceError('INVALID_REPOSITORY_URL', 400),
    );
    const submitted = 'https://evil.test/private/path';
    const response = await POST(postRequest({ repositoryUrl: submitted }));
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).toContain('INVALID_REPOSITORY_URL');
    expect(text).not.toContain(submitted);
  });
});
