import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
  process.env.REGISTRATION_MODE = 'open';
  process.env.SEED_DEMO_DATA = 'false';
});

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  startConnection: vi.fn(),
  completeConnection: vi.fn(),
  listConnections: vi.fn(),
  listRepositories: vi.fn(),
  selectRepositories: vi.fn(),
  enqueueRepository: vi.fn(),
  runJob: vi.fn(),
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    after: (callback: () => void | Promise<void>) => {
      mocks.after(callback);
      void callback();
    },
  };
});

vi.mock('@/lib/github/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/github/service')>();
  return {
    ...actual,
    githubConnectionService: {
      startConnection: mocks.startConnection,
      completeConnection: mocks.completeConnection,
      listConnections: mocks.listConnections,
      listRepositories: mocks.listRepositories,
      selectRepositories: mocks.selectRepositories,
    },
  };
});

vi.mock('@/lib/github/sync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/github/sync')>();
  return {
    ...actual,
    githubSyncService: {
      enqueueRepository: mocks.enqueueRepository,
      runJob: mocks.runJob,
    },
  };
});

import { NextRequest } from 'next/server';

import { authService } from '@/lib/auth/service';
import { dbReady } from '@/lib/db';
import { authRepository } from '@/lib/db/repositories/auth.repository';

import { GET as callback } from './callback/route';
import { POST as connect } from './connect/route';
import { GET as listConnections } from './connections/route';
import { POST as syncRepository } from './repositories/[repositoryId]/sync/route';
import { GET as listRepositories, PUT as selectRepositories } from './repositories/route';

const suffix = crypto.randomUUID().slice(0, 8);
let ownerCookie = '';

function request(path: string, sessionCookie = ownerCookie) {
  return new NextRequest(`https://resume.test${path}`, {
    headers: {
      cookie: sessionCookie,
      'x-request-id': `github-route-${suffix}`,
    },
  });
}

function jsonRequest(path: string, body: unknown, method = 'POST', origin = 'https://resume.test') {
  return new NextRequest(`https://resume.test${path}`, {
    method,
    headers: {
      cookie: ownerCookie,
      origin,
      'content-type': 'application/json',
      'x-request-id': `github-route-${suffix}`,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await dbReady;
  await authRepository.setRegistrationMode('open');
  const owner = await authService.register({
    username: `github_route_${suffix}`,
    password: 'GitHub route password long enough',
  }, { requestId: `github-route-owner-${suffix}` });
  ownerCookie = `jade_session=${owner.token}`;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.startConnection.mockResolvedValue({
    connectionId: '56dd9a18-a6ef-43ea-a789-698b4f6745d0',
    installationUrl: 'https://github.test/apps/jadeai/installations/new?state=opaque-state',
    expiresAt: new Date('2026-07-17T12:10:00.000Z'),
  });
  mocks.completeConnection.mockResolvedValue({
    connection: { id: '56dd9a18-a6ef-43ea-a789-698b4f6745d0' },
    returnPath: '/zh/knowledge',
  });
  mocks.listConnections.mockResolvedValue([{
    id: '56dd9a18-a6ef-43ea-a789-698b4f6745d0',
    userId: 'must-not-be-returned',
    provider: 'github',
    status: 'active',
    lastSyncedAt: new Date('2026-07-17T12:00:00.000Z'),
    lastErrorCode: null,
    createdAt: new Date('2026-07-17T11:00:00.000Z'),
    updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    installation: {
      id: 'internal-installation-row',
      userId: 'must-not-be-returned',
      sourceConnectionId: '56dd9a18-a6ef-43ea-a789-698b4f6745d0',
      installationId: '7001',
      accountId: '8001',
      accountLogin: 'alice',
      accountType: 'user',
      repositorySelection: 'selected',
      permissions: { contents: 'read', metadata: 'read' },
      suspendedAt: null,
      createdAt: new Date('2026-07-17T11:00:00.000Z'),
      updatedAt: new Date('2026-07-17T11:00:00.000Z'),
    },
    repositories: [{
      id: '6ac7fb25-e7c7-4ea3-aa0d-78edda33a920',
      userId: 'must-not-be-returned',
      sourceType: 'github',
      sourceConnectionId: '56dd9a18-a6ef-43ea-a789-698b4f6745d0',
      externalRepositoryId: '9001',
      fullName: 'alice/career-facts',
      defaultBranch: 'main',
      selected: true,
      lastHeadSha: 'a'.repeat(40),
      lastSyncedAt: new Date('2026-07-17T12:00:00.000Z'),
      createdAt: new Date('2026-07-17T11:00:00.000Z'),
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    }],
    recentJobs: [{
      id: 'a9adff25-b798-47f7-b245-eb21838557c9',
      userId: 'must-not-be-returned',
      sourceConnectionId: '56dd9a18-a6ef-43ea-a789-698b4f6745d0',
      sourceRepositoryId: '6ac7fb25-e7c7-4ea3-aa0d-78edda33a920',
      trigger: 'manual',
      status: 'succeeded',
      idempotencyKey: 'must-not-be-returned',
      requestedCommitSha: 'a'.repeat(40),
      attemptCount: 1,
      errorCode: null,
      errorMessage: null,
      requestId: null,
      webhookDeliveryId: null,
      nextAttemptAt: null,
      startedAt: new Date('2026-07-17T12:00:00.000Z'),
      completedAt: new Date('2026-07-17T12:00:01.000Z'),
      createdAt: new Date('2026-07-17T12:00:00.000Z'),
      updatedAt: new Date('2026-07-17T12:00:01.000Z'),
    }],
  }]);
  mocks.listRepositories.mockResolvedValue([{
    id: '9001',
    nodeId: 'must-not-be-returned',
    name: 'career-facts',
    fullName: 'alice/career-facts',
    private: true,
    defaultBranch: 'main',
    archived: false,
    disabled: false,
    selected: true,
    token: 'must-not-be-returned',
  }]);
  mocks.selectRepositories.mockResolvedValue([{
    id: '6ac7fb25-e7c7-4ea3-aa0d-78edda33a920',
    userId: 'must-not-be-returned',
    sourceType: 'github',
    sourceConnectionId: '56dd9a18-a6ef-43ea-a789-698b4f6745d0',
    externalRepositoryId: '9001',
    fullName: 'alice/career-facts',
    defaultBranch: 'main',
    selected: true,
    lastHeadSha: null,
    lastSyncedAt: null,
  }]);
  mocks.enqueueRepository.mockResolvedValue({
    job: { id: 'a9adff25-b798-47f7-b245-eb21838557c9', status: 'queued' },
    created: true,
    requeued: false,
  });
  mocks.runJob.mockResolvedValue({ status: 'succeeded' });
});

describe('GitHub account routes', () => {
  it('requires authentication and a trusted origin for state-changing requests', async () => {
    expect((await listConnections(new NextRequest('https://resume.test/api/github/connections'))).status)
      .toBe(401);
    expect((await connect(jsonRequest('/api/github/connect', {}, 'POST', 'https://evil.test'))).status)
      .toBe(403);
    expect(mocks.startConnection).not.toHaveBeenCalled();
  });

  it('starts a one-time install flow and redirects a valid callback to the saved locale', async () => {
    const started = await connect(jsonRequest('/api/github/connect', { returnPath: '/zh/knowledge' }));
    expect(started.status).toBe(201);
    expect(started.headers.get('cache-control')).toBe('no-store');
    await expect(started.json()).resolves.toEqual({
      connectionId: '56dd9a18-a6ef-43ea-a789-698b4f6745d0',
      installationUrl: 'https://github.test/apps/jadeai/installations/new?state=opaque-state',
      expiresAt: '2026-07-17T12:10:00.000Z',
    });

    const completed = await callback(request('/api/github/callback?state=opaque-state&installation_id=7001'));
    expect(completed.status).toBe(307);
    expect(completed.headers.get('location')).toBe('https://resume.test/zh/knowledge?github=connected');
  });

  it('returns only UI-safe connection and repository fields', async () => {
    const connections = await listConnections(request('/api/github/connections'));
    expect(connections.status).toBe(200);
    const connectionText = await connections.text();
    expect(connectionText).not.toContain('must-not-be-returned');
    expect(connectionText).not.toContain('installationId');
    expect(connectionText).not.toContain('permissions');
    expect(connectionText).not.toContain('idempotencyKey');

    const available = await listRepositories(request(
      '/api/github/repositories?connectionId=56dd9a18-a6ef-43ea-a789-698b4f6745d0',
    ));
    expect(available.status).toBe(200);
    const availableText = await available.text();
    expect(availableText).not.toContain('nodeId');
    expect(availableText).not.toContain('token');
    await expect(Promise.resolve(JSON.parse(availableText))).resolves.toEqual([{
      id: '9001',
      name: 'career-facts',
      fullName: 'alice/career-facts',
      private: true,
      defaultBranch: 'main',
      archived: false,
      disabled: false,
      selected: true,
    }]);

    const selected = await selectRepositories(jsonRequest('/api/github/repositories', {
      connectionId: '56dd9a18-a6ef-43ea-a789-698b4f6745d0',
      repositoryIds: ['9001'],
    }, 'PUT'));
    const selectedText = await selected.text();
    expect(selectedText).not.toContain('must-not-be-returned');
    expect(selectedText).not.toContain('sourceConnectionId');
    expect(JSON.parse(selectedText)).toEqual([expect.objectContaining({
      id: '6ac7fb25-e7c7-4ea3-aa0d-78edda33a920',
      externalRepositoryId: '9001',
      selected: true,
    })]);
  });

  it('enqueues a user-owned manual sync and schedules the worker', async () => {
    const response = await syncRepository(
      jsonRequest('/api/github/repositories/6ac7fb25-e7c7-4ea3-aa0d-78edda33a920/sync', {}),
      { params: Promise.resolve({ repositoryId: '6ac7fb25-e7c7-4ea3-aa0d-78edda33a920' }) },
    );
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      jobId: 'a9adff25-b798-47f7-b245-eb21838557c9',
      status: 'queued',
      created: true,
      requeued: false,
    });
    expect(mocks.enqueueRepository).toHaveBeenCalledWith(
      expect.objectContaining({ userId: expect.any(String) }),
      '6ac7fb25-e7c7-4ea3-aa0d-78edda33a920',
      'manual',
    );
    await vi.waitFor(() => expect(mocks.runJob).toHaveBeenCalledWith(
      'a9adff25-b798-47f7-b245-eb21838557c9',
    ));
  });
});
