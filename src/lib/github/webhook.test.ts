import { createHash, createHmac } from 'node:crypto';

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
});

import { db, dbReady } from '@/lib/db';
import {
  githubInstallations,
  sourceConnections,
  sourceRepositories,
  syncJobs,
  users,
  webhookDeliveries,
} from '@/lib/db/schema';

import { GitHubWebhookError, handleGitHubWebhook, verifyGitHubWebhookSignature } from './webhook';

const secret = 'webhook-test-secret-with-entropy';
const suffix = crypto.randomUUID();
const userId = `webhook-user-${suffix}`;
const connectionId = `webhook-connection-${suffix}`;
const repositoryId = `webhook-repository-${suffix}`;
const installationId = `webhook-installation-row-${suffix}`;
const externalInstallationId = '82001';
const externalRepositoryId = '92001';

function signedInput(deliveryId: string, eventType: string, payload: Record<string, unknown>) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  return {
    rawBody,
    signature: `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`,
    deliveryId,
    eventType,
    webhookSecret: secret,
  };
}

beforeAll(async () => {
  await dbReady;
  await db.insert(users).values({ id: userId, username: `webhook-${suffix}`, authType: 'password' });
  await db.insert(sourceConnections).values({
    id: connectionId,
    userId,
    provider: 'github',
    status: 'active',
  });
  await db.insert(githubInstallations).values({
    id: installationId,
    userId,
    sourceConnectionId: connectionId,
    installationId: externalInstallationId,
    accountId: '72001',
    accountLogin: 'alice',
    accountType: 'user',
    repositorySelection: 'selected',
    permissions: { contents: 'read', metadata: 'read' },
  });
  await db.insert(sourceRepositories).values({
    id: repositoryId,
    userId,
    sourceType: 'github',
    sourceConnectionId: connectionId,
    externalRepositoryId,
    fullName: 'alice/career-facts',
    defaultBranch: 'main',
    selected: true,
  });
});

describe('GitHub webhook receiver', () => {
  it('validates the raw-body HMAC with constant-size digests', () => {
    const bytes = Buffer.from('{"zen":"test"}');
    const signature = `sha256=${createHmac('sha256', secret).update(bytes).digest('hex')}`;
    expect(verifyGitHubWebhookSignature(bytes, signature, secret)).toBe(true);
    expect(verifyGitHubWebhookSignature(Buffer.from('{"zen":"changed"}'), signature, secret)).toBe(false);
    expect(verifyGitHubWebhookSignature(bytes, 'sha1=bad', secret)).toBe(false);
  });

  it('rejects an invalid signature before persisting delivery metadata', async () => {
    const before = (await db.select().from(webhookDeliveries)).length;
    await expect(handleGitHubWebhook({
      rawBody: Buffer.from('{}'),
      signature: `sha256=${'0'.repeat(64)}`,
      deliveryId: `invalid-${suffix}`,
      eventType: 'ping',
      webhookSecret: secret,
    })).rejects.toEqual(expect.objectContaining<Partial<GitHubWebhookError>>({
      code: 'INVALID_SIGNATURE',
      status: 401,
    }));
    expect(await db.select().from(webhookDeliveries)).toHaveLength(before);
  });

  it('enqueues a selected default-branch push exactly once across delivery replay', async () => {
    const payload = {
      ref: 'refs/heads/main',
      before: 'a'.repeat(40),
      after: 'b'.repeat(40),
      deleted: false,
      installation: { id: Number(externalInstallationId) },
      repository: { id: Number(externalRepositoryId) },
    };
    const input = signedInput(`push-${suffix}`, 'push', payload);
    const first = await handleGitHubWebhook(input);
    const second = await handleGitHubWebhook(input);
    expect(first).toMatchObject({ accepted: true, duplicate: false, status: 'processed', jobCreated: true });
    expect(second).toMatchObject({ accepted: true, duplicate: true, jobId: first.jobId });
    expect(second).toMatchObject({ jobCreated: false });
    expect((await db.select().from(syncJobs)).filter(
      (job: typeof syncJobs.$inferSelect) => job.webhookDeliveryId === input.deliveryId,
    )).toHaveLength(1);
  });

  it('resumes a previously recorded but unfinished delivery idempotently', async () => {
    const input = signedInput(`unfinished-${suffix}`, 'push', {
      ref: 'refs/heads/main',
      before: 'c'.repeat(40),
      after: 'd'.repeat(40),
      deleted: false,
      installation: { id: Number(externalInstallationId) },
      repository: { id: Number(externalRepositoryId) },
    });
    await db.insert(webhookDeliveries).values({
      deliveryId: input.deliveryId,
      eventType: input.eventType,
      installationId: externalInstallationId,
      repositoryExternalId: externalRepositoryId,
      ref: 'refs/heads/main',
      beforeSha: 'c'.repeat(40),
      afterSha: 'd'.repeat(40),
      payloadHash: `sha256:${createHash('sha256').update(input.rawBody).digest('hex')}`,
      status: 'accepted',
    });
    const result = await handleGitHubWebhook(input);
    expect(result).toMatchObject({
      accepted: true,
      duplicate: true,
      status: 'processed',
      jobCreated: true,
    });
  });

  it('records but does not enqueue non-default branch pushes', async () => {
    const result = await handleGitHubWebhook(signedInput(`branch-${suffix}`, 'push', {
      ref: 'refs/heads/feature',
      before: 'b'.repeat(40),
      after: 'c'.repeat(40),
      installation: { id: Number(externalInstallationId) },
      repository: { id: Number(externalRepositoryId) },
    }));
    expect(result).toEqual({ accepted: true, duplicate: false, status: 'ignored', jobId: null });
  });

  it('updates repository metadata and deselects archived repositories', async () => {
    await handleGitHubWebhook(signedInput(`renamed-${suffix}`, 'repository', {
      action: 'renamed',
      installation: { id: Number(externalInstallationId) },
      repository: {
        id: Number(externalRepositoryId),
        full_name: 'alice/renamed-career-facts',
        default_branch: 'trunk',
        archived: false,
        disabled: false,
      },
    }));
    expect((await db.select().from(sourceRepositories)).find(
      (repository: typeof sourceRepositories.$inferSelect) => repository.id === repositoryId,
    )).toMatchObject({ fullName: 'alice/renamed-career-facts', defaultBranch: 'trunk', selected: true });

    await handleGitHubWebhook(signedInput(`archived-${suffix}`, 'repository', {
      action: 'archived',
      installation: { id: Number(externalInstallationId) },
      repository: {
        id: Number(externalRepositoryId),
        full_name: 'alice/renamed-career-facts',
        default_branch: 'trunk',
        archived: true,
        disabled: false,
      },
    }));
    expect((await db.select().from(sourceRepositories)).find(
      (repository: typeof sourceRepositories.$inferSelect) => repository.id === repositoryId,
    )?.selected).toBe(false);
  });

  it('revokes the connection and deselects repositories on installation deletion', async () => {
    const result = await handleGitHubWebhook(signedInput(`deleted-${suffix}`, 'installation', {
      action: 'deleted',
      installation: { id: Number(externalInstallationId) },
    }));
    expect(result).toMatchObject({ accepted: true, status: 'processed' });
    expect((await db.select().from(sourceConnections)).find(
      (connection: typeof sourceConnections.$inferSelect) => connection.id === connectionId,
    )).toMatchObject({ status: 'revoked', lastErrorCode: 'INSTALLATION_REVOKED' });
    expect((await db.select().from(sourceRepositories)).find(
      (repository: typeof sourceRepositories.$inferSelect) => repository.id === repositoryId,
    )?.selected).toBe(false);
  });
});
