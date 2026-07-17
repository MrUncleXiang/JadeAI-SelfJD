import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
  process.env.LLM_ENCRYPTION_KEYS = JSON.stringify({
    1: Buffer.alloc(32, 9).toString('base64'),
  });
  process.env.LLM_ENCRYPTION_ACTIVE_KEY_VERSION = '1';
});

import type { ActorContext } from '@/lib/auth/service';
import { db, dbReady } from '@/lib/db';
import {
  auditEvents,
  githubPatCredentials,
  sourceConnections,
  sourceRepositories,
  users,
} from '@/lib/db/schema';

import { GitHubApiError } from './client';
import {
  type GitHubPatConnectionApi,
  GitHubPatServiceError,
  githubPatService,
} from './pat-service';

const suffix = crypto.randomUUID();
const userId = `github-pat-service-${suffix}`;
const otherUserId = `github-pat-other-${suffix}`;
const token = `github_pat_${'A1_'.repeat(20)}`;
type GitHubPatCredentialRow = typeof githubPatCredentials.$inferSelect;
type SourceConnectionRow = typeof sourceConnections.$inferSelect;
type SourceRepositoryRow = typeof sourceRepositories.$inferSelect;

function actor(id: string): ActorContext {
  return {
    userId: id,
    role: 'user',
    sessionId: `session-${id}`,
    requestId: `request-${id}`,
    user: {
      id,
      username: id,
      email: null,
      name: id,
      avatarUrl: null,
      role: 'user',
      status: 'active',
      authType: 'password',
    },
  };
}

const owner = actor(userId);
const other = actor(otherUserId);

function repository() {
  return {
    id: '91001',
    nodeId: 'R_91001',
    name: 'career-facts',
    fullName: 'alice/career-facts',
    private: true,
    defaultBranch: 'main',
    archived: false,
    disabled: false,
  };
}

function api(): GitHubPatConnectionApi {
  return {
    getAuthenticatedUser: vi.fn().mockResolvedValue({ id: '71001', login: 'alice' }),
    listRepositories: vi.fn().mockResolvedValue([repository()]),
  };
}

beforeAll(async () => {
  await dbReady;
  await db.insert(users).values([
    { id: userId, username: userId, authType: 'password' },
    { id: otherUserId, username: otherUserId, authType: 'password' },
  ]);
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fine-grained GitHub PAT service', () => {
  it('validates, encrypts, lists, and selects without exposing plaintext credentials', async () => {
    const client = api();
    const created = await githubPatService.createConnection(owner, {
      label: 'Career facts',
      token,
    }, { client });
    expect(created).toMatchObject({ userId, provider: 'github-pat', status: 'active' });
    expect(client.getAuthenticatedUser).toHaveBeenCalledOnce();

    const credentialRows = await db.select().from(githubPatCredentials);
    const credential = credentialRows.find(
      (row: GitHubPatCredentialRow) => row.sourceConnectionId === created.id,
    )!;
    expect(credential).toMatchObject({ accountLogin: 'alice', label: 'Career facts' });
    expect(credential.encryptedToken).not.toBe(token);
    expect(JSON.stringify(credential)).not.toContain(token);

    const listed = await githubPatService.listConnections(owner);
    expect(listed).toEqual([
      expect.objectContaining({
        id: created.id,
        credential: {
          sourceConnectionId: created.id,
          label: 'Career facts',
          accountId: '71001',
          accountLogin: 'alice',
        },
      }),
    ]);
    expect(JSON.stringify(listed)).not.toContain(token);
    expect(JSON.stringify(listed)).not.toContain(credential.encryptedToken);

    await expect(githubPatService.listRepositories(owner, created.id, { client }))
      .resolves.toEqual([expect.objectContaining({ id: '91001', selected: false })]);
    await expect(githubPatService.selectRepositories(owner, created.id, ['91001'], { client }))
      .resolves.toEqual([expect.objectContaining({ externalRepositoryId: '91001', selected: true })]);

    expect(await githubPatService.listConnections(other)).toEqual([]);
    await expect(githubPatService.listRepositories(other, created.id, { client }))
      .rejects.toEqual(expect.objectContaining<Partial<GitHubPatServiceError>>({
        code: 'CONNECTION_NOT_FOUND',
        status: 404,
      }));

    const serializedPersistence = JSON.stringify({
      connections: await db.select().from(sourceConnections),
      repositories: await db.select().from(sourceRepositories),
      audits: await db.select().from(auditEvents),
    });
    expect(serializedPersistence).not.toContain(token);
  });

  it('rejects classic tokens before any outbound GitHub call', async () => {
    const client = api();
    await expect(githubPatService.createConnection(owner, {
      token: `ghp_${'a'.repeat(40)}`,
    }, { client })).rejects.toEqual(expect.objectContaining<Partial<GitHubPatServiceError>>({
      code: 'INVALID_PAT_FORMAT',
      status: 400,
    }));
    expect(client.getAuthenticatedUser).not.toHaveBeenCalled();
    expect(client.listRepositories).not.toHaveBeenCalled();
  });

  it('deletes the encrypted credential and deselects repositories when GitHub rejects it', async () => {
    const goodClient = api();
    const created = await githubPatService.createConnection(owner, {
      label: 'Revoked token test',
      token: `github_pat_${'B2_'.repeat(20)}`,
    }, { client: goodClient });
    await githubPatService.selectRepositories(owner, created.id, ['91001'], { client: goodClient });

    const rejectedClient: GitHubPatConnectionApi = {
      getAuthenticatedUser: vi.fn(),
      listRepositories: vi.fn().mockRejectedValue(new GitHubApiError('AUTH_FAILED', 401)),
    };
    await expect(githubPatService.listRepositories(owner, created.id, {
      client: rejectedClient,
    })).rejects.toEqual(expect.objectContaining<Partial<GitHubPatServiceError>>({
      code: 'PAT_REVOKED',
      status: 401,
    }));

    expect((await db.select().from(githubPatCredentials)).some(
      (row: GitHubPatCredentialRow) => row.sourceConnectionId === created.id,
    )).toBe(false);
    expect((await db.select().from(sourceConnections)).find(
      (row: SourceConnectionRow) => row.id === created.id,
    )).toMatchObject({ status: 'revoked', lastErrorCode: 'PAT_REVOKED' });
    expect((await db.select().from(sourceRepositories)).filter(
      (row: SourceRepositoryRow) => row.sourceConnectionId === created.id,
    )).toEqual([expect.objectContaining({ selected: false })]);
  });
});
