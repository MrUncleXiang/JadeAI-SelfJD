import { beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
});

import { db, dbReady } from '../index';
import {
  githubInstallations,
  sourceConnections,
  sourceRepositories,
  syncJobs,
  users,
  webhookDeliveries,
} from '../schema';
import { githubRepository } from './github.repository';

const suffix = crypto.randomUUID();
type SourceConnectionRow = typeof sourceConnections.$inferSelect;
type SourceRepositoryRow = typeof sourceRepositories.$inferSelect;
type SyncJobRow = typeof syncJobs.$inferSelect;
type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
const userA = `github-a-${suffix}`;
const userB = `github-b-${suffix}`;
let connectionA = '';
let connectionB = '';
let repositoryA = '';

beforeAll(async () => {
  await dbReady;
  await db.insert(users).values([
    { id: userA, username: `github-a-${suffix}`, authType: 'password' },
    { id: userB, username: `github-b-${suffix}`, authType: 'password' },
  ]);
});

describe('GitHub source repository', () => {
  it('binds a short-lived state to one user and consumes it only once', async () => {
    const createdA = await githubRepository.createConnectionStateOwned({
      userId: userA,
      stateHash: `state-a-${suffix}`,
      returnPath: '/zh/knowledge',
      expiresAt: new Date(Date.now() + 60_000),
    });
    connectionA = createdA.connectionId;
    const createdB = await githubRepository.createConnectionStateOwned({
      userId: userB,
      stateHash: `state-b-${suffix}`,
      returnPath: '/zh/knowledge',
      expiresAt: new Date(Date.now() + 60_000),
    });
    connectionB = createdB.connectionId;

    await expect(githubRepository.consumeConnectionStateOwned(
      userB,
      `state-a-${suffix}`,
      new Date(),
    )).resolves.toBeNull();
    await expect(githubRepository.consumeConnectionStateOwned(
      userA,
      `state-a-${suffix}`,
      new Date(),
    )).resolves.toEqual({ sourceConnectionId: connectionA, returnPath: '/zh/knowledge' });
    await expect(githubRepository.consumeConnectionStateOwned(
      userA,
      `state-a-${suffix}`,
      new Date(),
    )).resolves.toBeNull();
  });

  it('prevents two users from binding the same GitHub App installation', async () => {
    const installation = {
      id: `installation-${suffix}`,
      account: { id: `account-${suffix}`, login: 'alice', type: 'user' as const },
      repositorySelection: 'selected' as const,
      permissions: { contents: 'read', metadata: 'read' },
      suspendedAt: null,
    };
    await expect(githubRepository.bindInstallationOwned({
      userId: userA,
      sourceConnectionId: connectionA,
      installation,
    })).resolves.toMatchObject({ installationId: installation.id, userId: userA });
    await expect(githubRepository.bindInstallationOwned({
      userId: userB,
      sourceConnectionId: connectionB,
      installation,
    })).rejects.toMatchObject({ code: 'INSTALLATION_ALREADY_BOUND' });
    expect(await db.select().from(githubInstallations)).toHaveLength(1);
    expect((await db.select().from(sourceConnections)).find(
      (row: SourceConnectionRow) => row.id === connectionA,
    )?.status)
      .toBe('active');
  });

  it('stores only explicitly selected accessible repositories', async () => {
    const rows = await githubRepository.replaceSelectedRepositoriesOwned({
      userId: userA,
      sourceConnectionId: connectionA,
      selected: [{
        id: `repo-${suffix}`,
        nodeId: null,
        name: 'career-facts',
        fullName: 'alice/career-facts',
        private: true,
        defaultBranch: 'main',
        archived: false,
        disabled: false,
      }],
    });
    repositoryA = rows.find(
      (row: SourceRepositoryRow) => row.externalRepositoryId === `repo-${suffix}`,
    )!.id;
    await expect(githubRepository.findRepositoryOwned(userA, repositoryA))
      .resolves.toMatchObject({ selected: true, fullName: 'alice/career-facts' });
    await expect(githubRepository.findRepositoryOwned(userB, repositoryA)).resolves.toBeNull();
    expect(await db.select().from(sourceRepositories)).toHaveLength(1);
  });

  it('deduplicates sync jobs by repository, commit, and parser identity', async () => {
    const input = {
      userId: userA,
      sourceConnectionId: connectionA,
      sourceRepositoryId: repositoryA,
      trigger: 'manual' as const,
      idempotencyKey: `github:${repositoryA}:${'a'.repeat(40)}:workresume-v2@1`,
      requestedCommitSha: 'a'.repeat(40),
    };
    const first = await githubRepository.enqueueSyncJobOwned(input);
    const second = await githubRepository.enqueueSyncJobOwned(input);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    expect((await db.select().from(syncJobs)).filter(
      (job: SyncJobRow) => job.userId === userA,
    )).toHaveLength(1);
  });

  it('accepts a webhook delivery exactly once and rejects payload substitution', async () => {
    const input = {
      deliveryId: `delivery-${suffix}`,
      eventType: 'push',
      installationId: `installation-${suffix}`,
      repositoryExternalId: `repo-${suffix}`,
      ref: 'refs/heads/main',
      beforeSha: 'a'.repeat(40),
      afterSha: 'b'.repeat(40),
      payloadHash: `sha256:${'1'.repeat(64)}`,
    };
    await expect(githubRepository.recordWebhookDelivery(input))
      .resolves.toMatchObject({ duplicate: false });
    await expect(githubRepository.recordWebhookDelivery(input))
      .resolves.toMatchObject({ duplicate: true });
    await expect(githubRepository.recordWebhookDelivery({ ...input, payloadHash: `sha256:${'2'.repeat(64)}` }))
      .rejects.toMatchObject({ code: 'WEBHOOK_DELIVERY_CONFLICT' });
    expect((await db.select().from(webhookDeliveries)).filter(
      (delivery: WebhookDeliveryRow) => delivery.deliveryId === input.deliveryId,
    )).toHaveLength(1);
  });

  it('has no persisted installation access-token column', async () => {
    const columns = await db.all(sql`PRAGMA table_info(github_installations)`) as Array<{ name: string }>;
    expect(columns.map((column) => column.name).filter((name) => /token/i.test(name))).toEqual([]);
  });
});
