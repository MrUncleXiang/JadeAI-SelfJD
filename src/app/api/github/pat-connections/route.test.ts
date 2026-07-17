import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
  process.env.REGISTRATION_MODE = 'open';
  process.env.SEED_DEMO_DATA = 'false';
});

const mocks = vi.hoisted(() => ({
  listConnections: vi.fn(),
  createConnection: vi.fn(),
  listRepositories: vi.fn(),
  selectRepositories: vi.fn(),
  revokeConnection: vi.fn(),
}));

vi.mock('@/lib/github/pat-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/github/pat-service')>();
  return {
    ...actual,
    githubPatService: {
      listConnections: mocks.listConnections,
      createConnection: mocks.createConnection,
      listRepositories: mocks.listRepositories,
      selectRepositories: mocks.selectRepositories,
      revokeConnection: mocks.revokeConnection,
    },
  };
});

import { NextRequest } from 'next/server';

import { authService } from '@/lib/auth/service';
import { dbReady } from '@/lib/db';
import { authRepository } from '@/lib/db/repositories/auth.repository';

import { DELETE } from './[connectionId]/route';
import {
  GET as GET_REPOSITORIES,
  PUT as PUT_REPOSITORIES,
} from './[connectionId]/repositories/route';
import { GET, POST } from './route';

const suffix = crypto.randomUUID().slice(0, 8);
const connectionId = crypto.randomUUID();
const token = `github_pat_${'C3_'.repeat(20)}`;
let ownerCookie = '';

interface TestRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function request(
  path = '/api/github/pat-connections',
  init: TestRequestInit = {},
  cookie = ownerCookie,
) {
  return new NextRequest(`https://resume.test${path}`, {
    ...init,
    headers: {
      cookie,
      'x-request-id': `github-pat-route-${suffix}`,
      ...init.headers,
    },
  });
}

function mutation(path: string, method: string, body?: unknown, origin = 'https://resume.test') {
  return request(path, {
    method,
    headers: {
      origin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const params = Promise.resolve({ connectionId });

beforeAll(async () => {
  await dbReady;
  await authRepository.setRegistrationMode('open');
  const owner = await authService.register({
    username: `github_pat_route_${suffix}`,
    password: 'GitHub PAT route password long enough',
  }, { requestId: `github-pat-route-owner-${suffix}` });
  ownerCookie = `jade_session=${owner.token}`;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listConnections.mockResolvedValue([{
    id: connectionId,
    userId: 'owner-id',
    provider: 'github-pat',
    status: 'active',
    lastSyncedAt: null,
    lastErrorCode: null,
    createdAt: new Date('2026-07-17T10:00:00.000Z'),
    updatedAt: new Date('2026-07-17T10:00:00.000Z'),
    credential: {
      sourceConnectionId: connectionId,
      label: 'Career facts',
      accountId: '71001',
      accountLogin: 'alice',
      encryptedToken: 'ciphertext-must-not-be-returned',
    },
    repositories: [],
    recentJobs: [],
  }]);
  mocks.createConnection.mockResolvedValue({
    id: connectionId,
    userId: 'owner-id',
    provider: 'github-pat',
    status: 'active',
    lastSyncedAt: null,
    lastErrorCode: null,
    createdAt: new Date('2026-07-17T10:00:00.000Z'),
    updatedAt: new Date('2026-07-17T10:00:00.000Z'),
  });
  mocks.listRepositories.mockResolvedValue([{
    id: '91001',
    nodeId: 'R_91001',
    name: 'career-facts',
    fullName: 'alice/career-facts',
    private: true,
    defaultBranch: 'main',
    archived: false,
    disabled: false,
    selected: false,
  }]);
  mocks.selectRepositories.mockResolvedValue([{
    id: 'stored-repository-id',
    userId: 'owner-id',
    sourceType: 'github-pat',
    sourceConnectionId: connectionId,
    externalRepositoryId: '91001',
    fullName: 'alice/career-facts',
    defaultBranch: 'main',
    selected: true,
    lastHeadSha: null,
    lastSyncedAt: null,
    createdAt: new Date('2026-07-17T10:00:00.000Z'),
    updatedAt: new Date('2026-07-17T10:00:00.000Z'),
  }]);
  mocks.revokeConnection.mockResolvedValue(undefined);
});

describe('GitHub PAT connection routes', () => {
  it('requires authentication and trusted origins for mutations', async () => {
    expect((await GET(request('/api/github/pat-connections', {}, ''))).status).toBe(401);
    expect((await POST(mutation('/api/github/pat-connections', 'POST', {
      token,
    }, 'https://evil.test'))).status).toBe(403);
    expect((await PUT_REPOSITORIES(
      mutation(`/api/github/pat-connections/${connectionId}/repositories`, 'PUT', {
        repositoryIds: ['91001'],
      }, 'https://evil.test'),
      { params },
    )).status).toBe(403);
    expect((await DELETE(
      mutation(`/api/github/pat-connections/${connectionId}`, 'DELETE', undefined, 'https://evil.test'),
      { params },
    )).status).toBe(403);
  });

  it('returns only sanitized connection metadata and never echoes a submitted token', async () => {
    const listed = await GET(request());
    expect(listed.status).toBe(200);
    const listedText = await listed.text();
    expect(listedText).toContain('Career facts');
    expect(listedText).not.toContain('ciphertext-must-not-be-returned');
    expect(listedText).not.toContain('accountId');

    const created = await POST(mutation('/api/github/pat-connections', 'POST', {
      label: 'Career facts',
      token,
    }));
    expect(created.status).toBe(201);
    expect(created.headers.get('cache-control')).toBe('no-store');
    const createdText = await created.text();
    expect(createdText).not.toContain(token);
    expect(mocks.createConnection).toHaveBeenCalledWith(
      expect.objectContaining({ userId: expect.any(String) }),
      { label: 'Career facts', token },
    );
  });

  it('lists and updates only repositories under the path-scoped connection', async () => {
    const listed = await GET_REPOSITORIES(
      request(`/api/github/pat-connections/${connectionId}/repositories`),
      { params },
    );
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toEqual([
      expect.objectContaining({ id: '91001', fullName: 'alice/career-facts', selected: false }),
    ]);
    expect(mocks.listRepositories).toHaveBeenCalledWith(
      expect.objectContaining({ userId: expect.any(String) }),
      connectionId,
    );

    const updated = await PUT_REPOSITORIES(
      mutation(`/api/github/pat-connections/${connectionId}/repositories`, 'PUT', {
        repositoryIds: ['91001'],
      }),
      { params },
    );
    expect(updated.status).toBe(200);
    expect(mocks.selectRepositories).toHaveBeenCalledWith(
      expect.objectContaining({ userId: expect.any(String) }),
      connectionId,
      ['91001'],
    );
  });

  it('revokes with no response body and validates path identifiers', async () => {
    const revoked = await DELETE(
      mutation(`/api/github/pat-connections/${connectionId}`, 'DELETE'),
      { params },
    );
    expect(revoked.status).toBe(204);
    expect(await revoked.text()).toBe('');
    expect(mocks.revokeConnection).toHaveBeenCalledWith(
      expect.objectContaining({ userId: expect.any(String) }),
      connectionId,
    );

    const invalid = await DELETE(
      mutation('/api/github/pat-connections/not-a-uuid', 'DELETE'),
      { params: Promise.resolve({ connectionId: 'not-a-uuid' }) },
    );
    expect(invalid.status).toBe(400);
  });
});
