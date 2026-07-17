import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
});

import type { ActorContext } from '@/lib/auth/service';
import { db, dbReady } from '@/lib/db';
import { githubInstallations, sourceRepositories, users } from '@/lib/db/schema';

import type { GitHubAppConfig } from './config';
import {
  type GitHubConnectionApi,
  GitHubServiceError,
  githubConnectionService,
} from './service';

const suffix = crypto.randomUUID();
const userId = `github-service-${suffix}`;
const config: GitHubAppConfig = {
  appId: '12345',
  appSlug: 'jadeai-test',
  privateKey: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
  webhookSecret: 'test-webhook-secret-long-enough',
  apiBaseUrl: 'https://api.github.test',
  webBaseUrl: 'https://github.test',
};
const actor: ActorContext = {
  userId,
  role: 'user',
  sessionId: `session-${suffix}`,
  requestId: `request-${suffix}`,
  user: {
    id: userId,
    username: `github-service-${suffix}`,
    email: null,
    name: 'GitHub Service User',
    avatarUrl: null,
    role: 'user',
    status: 'active',
    authType: 'password',
  },
};

function api(
  permissions: Record<string, string> = { contents: 'read', metadata: 'read' },
  tokenPermissions: Record<string, string> = permissions,
) {
  return {
    getInstallation: vi.fn<GitHubConnectionApi['getInstallation']>().mockResolvedValue({
      id: '7001',
      account: { id: '8001', login: 'alice', type: 'user' },
      repositorySelection: 'selected',
      permissions,
      suspendedAt: null,
    }),
    createInstallationToken: vi.fn<GitHubConnectionApi['createInstallationToken']>().mockResolvedValue({
      token: 'ephemeral-only-in-memory',
      expiresAt: '2026-07-17T01:00:00Z',
      permissions: tokenPermissions,
    }),
    listInstallationRepositories: vi.fn<GitHubConnectionApi['listInstallationRepositories']>().mockResolvedValue([{
      id: '9001',
      nodeId: 'R_9001',
      name: 'career-facts',
      fullName: 'alice/career-facts',
      private: true,
      defaultBranch: 'main',
      archived: false,
      disabled: false,
    }]),
  } satisfies GitHubConnectionApi;
}

beforeAll(async () => {
  await dbReady;
  await db.insert(users).values({
    id: userId,
    username: actor.user.username,
    authType: 'password',
  });
});

describe('GitHub connection service', () => {
  it('completes a one-time installation flow and selects only live accessible repositories', async () => {
    const client = api();
    const started = await githubConnectionService.startConnection(actor, {
      returnPath: '/zh/knowledge?source=github',
    }, { config, client, now: () => new Date('2026-07-17T00:00:00Z') });
    const state = new URL(started.installationUrl).searchParams.get('state')!;
    expect(state).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(started.expiresAt.toISOString()).toBe('2026-07-17T00:10:00.000Z');

    const completed = await githubConnectionService.completeConnection(actor, {
      state,
      installationId: '7001',
    }, { config, client, now: () => new Date('2026-07-17T00:01:00Z') });
    expect(completed.returnPath).toBe('/zh/knowledge?source=github');
    expect(completed.connection).toMatchObject({ installationId: '7001', accountLogin: 'alice' });

    const repositories = await githubConnectionService.listRepositories(
      actor,
      started.connectionId,
      { config, client },
    );
    expect(repositories).toEqual([expect.objectContaining({ id: '9001', selected: false })]);
    expect(client.listInstallationRepositories).toHaveBeenCalledWith('ephemeral-only-in-memory');

    await expect(githubConnectionService.selectRepositories(
      actor,
      started.connectionId,
      ['9001'],
      { config, client },
    )).resolves.toEqual([expect.objectContaining({ externalRepositoryId: '9001', selected: true })]);
    expect(await db.select().from(sourceRepositories)).toEqual([
      expect.objectContaining({ userId, externalRepositoryId: '9001', selected: true }),
    ]);
    expect(JSON.stringify(await db.select().from(githubInstallations))).not.toContain('ephemeral-only-in-memory');
  });

  it('rejects write-capable installations and consumes the callback state', async () => {
    const client = api({ contents: 'write', metadata: 'read' });
    const started = await githubConnectionService.startConnection(actor, {}, {
      config,
      client,
      now: () => new Date('2026-07-17T02:00:00Z'),
    });
    const state = new URL(started.installationUrl).searchParams.get('state')!;
    await expect(githubConnectionService.completeConnection(actor, {
      state,
      installationId: '7001',
    }, { config, client, now: () => new Date('2026-07-17T02:01:00Z') }))
      .rejects.toEqual(expect.objectContaining<Partial<GitHubServiceError>>({
        code: 'INSUFFICIENT_APP_PERMISSIONS',
        status: 422,
      }));
    await expect(githubConnectionService.completeConnection(actor, {
      state,
      installationId: '7001',
    }, { config, client, now: () => new Date('2026-07-17T02:02:00Z') }))
      .rejects.toEqual(expect.objectContaining<Partial<GitHubServiceError>>({
        code: 'INVALID_CONNECTION_STATE',
      }));
  });

  it('rejects repositories not returned by the live installation API', async () => {
    const connections = await githubConnectionService.listConnections(actor);
    const active = connections.find((connection: { status: string }) => connection.status === 'active')!;
    await expect(githubConnectionService.selectRepositories(
      actor,
      active.id,
      ['9999'],
      { config, client: api() },
    )).rejects.toEqual(expect.objectContaining<Partial<GitHubServiceError>>({
      code: 'INVALID_REPOSITORY_SELECTION',
      status: 422,
    }));
  });

  it('rejects a token whose live permissions became write-capable after installation', async () => {
    const connections = await githubConnectionService.listConnections(actor);
    const active = connections.find((connection: { status: string }) => connection.status === 'active')!;
    await expect(githubConnectionService.listRepositories(
      actor,
      active.id,
      { config, client: api(undefined, { contents: 'write', metadata: 'read' }) },
    )).rejects.toEqual(expect.objectContaining<Partial<GitHubServiceError>>({
      code: 'INSUFFICIENT_APP_PERMISSIONS',
      status: 422,
    }));
  });
});
