import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import type { GitHubInstallation, GitHubRepository } from '@/lib/github/types';
import { config } from '@/lib/config';

import { db } from '../index';
import {
  githubConnectionStates,
  githubInstallations,
  sourceConnections,
  sourceDocuments,
  sourceRepositories,
  sourceSnapshots,
  syncJobs,
  webhookDeliveries,
} from '../schema';

type ConnectionRow = typeof sourceConnections.$inferSelect;
type InstallationRow = typeof githubInstallations.$inferSelect;
type RepositoryRow = typeof sourceRepositories.$inferSelect;
type SyncJobRow = typeof syncJobs.$inferSelect;

export type GitHubConnectionListItem = ConnectionRow & {
  installation: (InstallationRow & { permissions: Record<string, string> }) | null;
  repositories: Array<RepositoryRow & { selected: boolean }>;
  recentJobs: SyncJobRow[];
};

export class GitHubRepositoryError extends Error {
  constructor(public readonly code:
    | 'CONNECTION_NOT_FOUND'
    | 'CONNECTION_STATE_INVALID'
    | 'INSTALLATION_ALREADY_BOUND'
    | 'INSTALLATION_NOT_FOUND'
    | 'REPOSITORY_NOT_FOUND'
    | 'SYNC_JOB_NOT_FOUND'
    | 'WEBHOOK_DELIVERY_CONFLICT'
  ) {
    super(code);
    this.name = 'GitHubRepositoryError';
  }
}

function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return value as T;
}

function serializeInstallation(row: InstallationRow) {
  return {
    ...row,
    permissions: parseJsonColumn<Record<string, string>>(row.permissions, {}),
  };
}

function connectionStateResult(row: typeof githubConnectionStates.$inferSelect) {
  return { sourceConnectionId: row.sourceConnectionId, returnPath: row.returnPath };
}

export const githubRepository = {
  async createConnectionStateOwned(input: {
    userId: string;
    stateHash: string;
    returnPath: string;
    expiresAt: Date;
  }) {
    const connectionId = crypto.randomUUID();
    const stateId = crypto.randomUUID();
    const connection = {
      id: connectionId,
      userId: input.userId,
      provider: 'github' as const,
      status: 'pending' as const,
    } satisfies typeof sourceConnections.$inferInsert;
    const state = {
      id: stateId,
      userId: input.userId,
      sourceConnectionId: connectionId,
      stateHash: input.stateHash,
      returnPath: input.returnPath,
      expiresAt: input.expiresAt,
    } satisfies typeof githubConnectionStates.$inferInsert;
    if (config.db.type === 'sqlite') {
      return db.transaction((tx: typeof db) => {
        tx.insert(sourceConnections).values(connection).run();
        tx.insert(githubConnectionStates).values(state).run();
        return { connectionId, stateId };
      });
    }
    return db.transaction(async (tx: typeof db) => {
      await tx.insert(sourceConnections).values(connection);
      await tx.insert(githubConnectionStates).values(state);
      return { connectionId, stateId };
    });
  },

  async consumeConnectionStateOwned(userId: string, stateHash: string, now: Date) {
    const predicate = and(
      eq(githubConnectionStates.userId, userId),
      eq(githubConnectionStates.stateHash, stateHash),
      isNull(githubConnectionStates.consumedAt),
      gt(githubConnectionStates.expiresAt, now),
    );
    if (config.db.type === 'sqlite') {
      return db.transaction((tx: typeof db) => {
        const row = tx.select().from(githubConnectionStates).where(predicate).limit(1).get();
        if (!row) return null;
        const result = tx.update(githubConnectionStates).set({ consumedAt: now })
          .where(predicate).run();
        return result.changes === 1 ? connectionStateResult(row) : null;
      });
    }
    return db.transaction(async (tx: typeof db) => {
      const rows = await tx.update(githubConnectionStates).set({ consumedAt: now })
        .where(predicate).returning();
      return rows[0] ? connectionStateResult(rows[0]) : null;
    });
  },

  async bindInstallationOwned(input: {
    userId: string;
    sourceConnectionId: string;
    installation: GitHubInstallation;
  }) {
    const values = {
      id: crypto.randomUUID(),
      userId: input.userId,
      sourceConnectionId: input.sourceConnectionId,
      installationId: input.installation.id,
      accountId: input.installation.account.id,
      accountLogin: input.installation.account.login,
      accountType: input.installation.account.type,
      repositorySelection: input.installation.repositorySelection,
      permissions: input.installation.permissions,
      suspendedAt: input.installation.suspendedAt ? new Date(input.installation.suspendedAt) : null,
    } satisfies typeof githubInstallations.$inferInsert;
    if (config.db.type === 'sqlite') {
      db.transaction((tx: typeof db) => {
        const connection = tx.select().from(sourceConnections).where(and(
          eq(sourceConnections.id, input.sourceConnectionId),
          eq(sourceConnections.userId, input.userId),
          eq(sourceConnections.provider, 'github'),
        )).limit(1).get();
        if (!connection) throw new GitHubRepositoryError('CONNECTION_NOT_FOUND');
        const claimed = tx.select().from(githubInstallations)
          .where(eq(githubInstallations.installationId, input.installation.id)).limit(1).get();
        if (claimed && (claimed.userId !== input.userId || claimed.sourceConnectionId !== input.sourceConnectionId)) {
          throw new GitHubRepositoryError('INSTALLATION_ALREADY_BOUND');
        }
        const existing = tx.select().from(githubInstallations)
          .where(eq(githubInstallations.sourceConnectionId, input.sourceConnectionId)).limit(1).get();
        if (existing) {
          tx.update(githubInstallations).set({
            installationId: values.installationId,
            accountId: values.accountId,
            accountLogin: values.accountLogin,
            accountType: values.accountType,
            repositorySelection: values.repositorySelection,
            permissions: values.permissions,
            suspendedAt: values.suspendedAt,
            updatedAt: new Date(),
          }).where(eq(githubInstallations.id, existing.id)).run();
        } else {
          tx.insert(githubInstallations).values(values).run();
        }
        tx.update(sourceConnections).set({
          status: input.installation.suspendedAt ? 'suspended' : 'active',
          lastErrorCode: null,
          updatedAt: new Date(),
        }).where(eq(sourceConnections.id, input.sourceConnectionId)).run();
      });
    } else {
      await db.transaction(async (tx: typeof db) => {
        const connections = await tx.select().from(sourceConnections).where(and(
          eq(sourceConnections.id, input.sourceConnectionId),
          eq(sourceConnections.userId, input.userId),
          eq(sourceConnections.provider, 'github'),
        )).limit(1);
        if (!connections[0]) throw new GitHubRepositoryError('CONNECTION_NOT_FOUND');
        const claimedRows = await tx.select().from(githubInstallations)
          .where(eq(githubInstallations.installationId, input.installation.id)).limit(1);
        const claimed = claimedRows[0];
        if (claimed && (claimed.userId !== input.userId || claimed.sourceConnectionId !== input.sourceConnectionId)) {
          throw new GitHubRepositoryError('INSTALLATION_ALREADY_BOUND');
        }
        const existingRows = await tx.select().from(githubInstallations)
          .where(eq(githubInstallations.sourceConnectionId, input.sourceConnectionId)).limit(1);
        const existing = existingRows[0];
        if (existing) {
          await tx.update(githubInstallations).set({
            installationId: values.installationId,
            accountId: values.accountId,
            accountLogin: values.accountLogin,
            accountType: values.accountType,
            repositorySelection: values.repositorySelection,
            permissions: values.permissions,
            suspendedAt: values.suspendedAt,
            updatedAt: new Date(),
          }).where(eq(githubInstallations.id, existing.id));
        } else {
          await tx.insert(githubInstallations).values(values);
        }
        await tx.update(sourceConnections).set({
          status: input.installation.suspendedAt ? 'suspended' : 'active',
          lastErrorCode: null,
          updatedAt: new Date(),
        }).where(eq(sourceConnections.id, input.sourceConnectionId));
      });
    }
    return this.findInstallationOwned(input.userId, input.sourceConnectionId);
  },

  async findInstallationOwned(userId: string, sourceConnectionId: string) {
    const rows = await db.select().from(githubInstallations).where(and(
      eq(githubInstallations.userId, userId),
      eq(githubInstallations.sourceConnectionId, sourceConnectionId),
    )).limit(1);
    return rows[0] ? serializeInstallation(rows[0]) : null;
  },

  async listConnectionsOwned(userId: string): Promise<GitHubConnectionListItem[]> {
    const [connections, installations, repositories, jobs] = await Promise.all([
      db.select().from(sourceConnections).where(and(
        eq(sourceConnections.userId, userId), eq(sourceConnections.provider, 'github'),
      )).orderBy(desc(sourceConnections.createdAt)),
      db.select().from(githubInstallations).where(eq(githubInstallations.userId, userId)),
      db.select().from(sourceRepositories).where(and(
        eq(sourceRepositories.userId, userId), eq(sourceRepositories.sourceType, 'github'),
      )),
      db.select().from(syncJobs).where(eq(syncJobs.userId, userId)).orderBy(desc(syncJobs.createdAt)),
    ]);
    return connections.map((connection: ConnectionRow) => ({
      ...connection,
      installation: installations.find((row: InstallationRow) => row.sourceConnectionId === connection.id)
        ? serializeInstallation(installations.find(
          (row: InstallationRow) => row.sourceConnectionId === connection.id,
        )!)
        : null,
      repositories: repositories.filter(
        (row: RepositoryRow) => row.sourceConnectionId === connection.id,
      ).map((row: RepositoryRow) => ({ ...row, selected: Boolean(row.selected) })),
      recentJobs: jobs.filter((row: SyncJobRow) => row.sourceConnectionId === connection.id).slice(0, 10),
    }));
  },

  async replaceSelectedRepositoriesOwned(input: {
    userId: string;
    sourceConnectionId: string;
    selected: GitHubRepository[];
  }) {
    const repositoryValues = (repository: GitHubRepository) => ({
      id: crypto.randomUUID(),
      userId: input.userId,
      sourceType: 'github' as const,
      sourceConnectionId: input.sourceConnectionId,
      externalRepositoryId: repository.id,
      fullName: repository.fullName,
      defaultBranch: repository.defaultBranch,
      selected: true,
    } satisfies typeof sourceRepositories.$inferInsert);
    const repositoryUpdate = (repository: GitHubRepository) => ({
      sourceConnectionId: input.sourceConnectionId,
      fullName: repository.fullName,
      defaultBranch: repository.defaultBranch,
      selected: true,
      updatedAt: new Date(),
    });
    if (config.db.type === 'sqlite') {
      db.transaction((tx: typeof db) => {
        const installation = tx.select().from(githubInstallations).where(and(
          eq(githubInstallations.userId, input.userId),
          eq(githubInstallations.sourceConnectionId, input.sourceConnectionId),
        )).limit(1).get();
        if (!installation) throw new GitHubRepositoryError('INSTALLATION_NOT_FOUND');
        tx.update(sourceRepositories).set({ selected: false, updatedAt: new Date() }).where(and(
          eq(sourceRepositories.userId, input.userId),
          eq(sourceRepositories.sourceType, 'github'),
          eq(sourceRepositories.sourceConnectionId, input.sourceConnectionId),
        )).run();
        for (const repository of input.selected) {
          tx.insert(sourceRepositories).values(repositoryValues(repository)).onConflictDoNothing().run();
          tx.update(sourceRepositories).set(repositoryUpdate(repository)).where(and(
            eq(sourceRepositories.userId, input.userId),
            eq(sourceRepositories.sourceType, 'github'),
            eq(sourceRepositories.externalRepositoryId, repository.id),
          )).run();
        }
      });
    } else {
      await db.transaction(async (tx: typeof db) => {
        const installations = await tx.select().from(githubInstallations).where(and(
          eq(githubInstallations.userId, input.userId),
          eq(githubInstallations.sourceConnectionId, input.sourceConnectionId),
        )).limit(1);
        if (!installations[0]) throw new GitHubRepositoryError('INSTALLATION_NOT_FOUND');
        await tx.update(sourceRepositories).set({ selected: false, updatedAt: new Date() }).where(and(
          eq(sourceRepositories.userId, input.userId),
          eq(sourceRepositories.sourceType, 'github'),
          eq(sourceRepositories.sourceConnectionId, input.sourceConnectionId),
        ));
        for (const repository of input.selected) {
          await tx.insert(sourceRepositories).values(repositoryValues(repository)).onConflictDoNothing();
          await tx.update(sourceRepositories).set(repositoryUpdate(repository)).where(and(
            eq(sourceRepositories.userId, input.userId),
            eq(sourceRepositories.sourceType, 'github'),
            eq(sourceRepositories.externalRepositoryId, repository.id),
          ));
        }
      });
    }
    return db.select().from(sourceRepositories).where(and(
      eq(sourceRepositories.userId, input.userId),
      eq(sourceRepositories.sourceType, 'github'),
      eq(sourceRepositories.sourceConnectionId, input.sourceConnectionId),
    ));
  },

  async findRepositoryOwned(userId: string, repositoryId: string) {
    const rows = await db.select().from(sourceRepositories).where(and(
      eq(sourceRepositories.id, repositoryId),
      eq(sourceRepositories.userId, userId),
      eq(sourceRepositories.sourceType, 'github'),
    )).limit(1);
    return rows[0] ? { ...rows[0], selected: Boolean(rows[0].selected) } : null;
  },

  async enqueueSyncJobOwned(input: {
    userId: string;
    sourceConnectionId: string;
    sourceRepositoryId: string;
    trigger: 'initial' | 'manual' | 'webhook' | 'scheduled';
    idempotencyKey: string;
    requestedCommitSha: string;
    requestId?: string | null;
    webhookDeliveryId?: string | null;
  }) {
    const id = crypto.randomUUID();
    const values = {
      id,
      userId: input.userId,
      sourceConnectionId: input.sourceConnectionId,
      sourceRepositoryId: input.sourceRepositoryId,
      trigger: input.trigger,
      idempotencyKey: input.idempotencyKey,
      requestedCommitSha: input.requestedCommitSha,
      requestId: input.requestId || null,
      webhookDeliveryId: input.webhookDeliveryId || null,
    } satisfies typeof syncJobs.$inferInsert;
    await db.insert(syncJobs).values(values).onConflictDoNothing();
    const rows = await db.select().from(syncJobs).where(eq(syncJobs.idempotencyKey, input.idempotencyKey)).limit(1);
    let job = rows[0];
    if (!job || job.userId !== input.userId || job.sourceRepositoryId !== input.sourceRepositoryId) {
      throw new GitHubRepositoryError('SYNC_JOB_NOT_FOUND');
    }
    let requeued = false;
    if (job.id !== id
      && ['failed', 'cancelled'].includes(job.status)
      && ['manual', 'scheduled'].includes(input.trigger)) {
      await db.update(syncJobs).set({
        trigger: input.trigger,
        status: 'queued',
        errorCode: null,
        errorMessage: null,
        requestId: input.requestId || null,
        webhookDeliveryId: input.webhookDeliveryId || null,
        nextAttemptAt: null,
        startedAt: null,
        completedAt: null,
        updatedAt: new Date(),
      }).where(eq(syncJobs.id, job.id));
      const refreshed = await db.select().from(syncJobs).where(eq(syncJobs.id, job.id)).limit(1);
      job = refreshed[0];
      requeued = true;
    }
    return { job, created: job.id === id, requeued };
  },

  async findSyncJobOwned(userId: string, jobId: string) {
    const rows = await db.select().from(syncJobs).where(and(
      eq(syncJobs.id, jobId), eq(syncJobs.userId, userId),
    )).limit(1);
    return rows[0] || null;
  },

  async listDueRepositoriesForScheduledSync(staleBefore: Date, limit: number) {
    return db.select({
      id: sourceRepositories.id,
      userId: sourceRepositories.userId,
      sourceConnectionId: sourceRepositories.sourceConnectionId,
      lastSyncedAt: sourceRepositories.lastSyncedAt,
    }).from(sourceRepositories).innerJoin(
      sourceConnections,
      eq(sourceConnections.id, sourceRepositories.sourceConnectionId),
    ).where(and(
      eq(sourceRepositories.sourceType, 'github'),
      eq(sourceRepositories.selected, true),
      eq(sourceConnections.status, 'active'),
      or(isNull(sourceRepositories.lastSyncedAt), lte(sourceRepositories.lastSyncedAt, staleBefore)),
    )).orderBy(asc(sourceRepositories.lastSyncedAt), asc(sourceRepositories.id)).limit(limit);
  },

  async listRunnableSyncJobIds(now: Date, limit: number) {
    const rows = await db.select({ id: syncJobs.id }).from(syncJobs).where(or(
      eq(syncJobs.status, 'queued'),
      and(
        eq(syncJobs.status, 'retrying'),
        or(isNull(syncJobs.nextAttemptAt), lte(syncJobs.nextAttemptAt, now)),
      ),
    )).orderBy(asc(syncJobs.createdAt)).limit(limit);
    return rows.map((row: { id: string }) => row.id);
  },

  async claimSyncJob(jobId: string) {
    const predicate = and(
      eq(syncJobs.id, jobId),
      inArray(syncJobs.status, ['queued', 'retrying']),
    );
    if (config.db.type === 'sqlite') {
      const result = db.update(syncJobs).set({
        status: 'running',
        attemptCount: sql`${syncJobs.attemptCount} + 1`,
        startedAt: new Date(),
        updatedAt: new Date(),
      }).where(predicate).run();
      if (result.changes !== 1) return null;
    } else {
      const rows = await db.update(syncJobs).set({
        status: 'running',
        attemptCount: sql`${syncJobs.attemptCount} + 1`,
        startedAt: new Date(),
        updatedAt: new Date(),
      }).where(predicate).returning({ id: syncJobs.id });
      if (rows.length !== 1) return null;
    }
    const rows = await db.select().from(syncJobs).where(eq(syncJobs.id, jobId)).limit(1);
    return rows[0] || null;
  },

  async loadSyncContext(jobId: string) {
    const jobs = await db.select().from(syncJobs).where(eq(syncJobs.id, jobId)).limit(1);
    const job = jobs[0];
    if (!job) throw new GitHubRepositoryError('SYNC_JOB_NOT_FOUND');
    const repositories = await db.select().from(sourceRepositories).where(and(
      eq(sourceRepositories.id, job.sourceRepositoryId || ''),
      eq(sourceRepositories.userId, job.userId),
      eq(sourceRepositories.sourceConnectionId, job.sourceConnectionId),
    )).limit(1);
    const repository = repositories[0];
    if (!repository || !repository.selected) throw new GitHubRepositoryError('REPOSITORY_NOT_FOUND');
    const installations = await db.select().from(githubInstallations).where(and(
      eq(githubInstallations.userId, job.userId),
      eq(githubInstallations.sourceConnectionId, job.sourceConnectionId),
    )).limit(1);
    if (!installations[0]) throw new GitHubRepositoryError('INSTALLATION_NOT_FOUND');
    return { job, repository, installation: serializeInstallation(installations[0]) };
  },

  async latestSnapshotDocuments(input: {
    userId: string;
    sourceRepositoryId: string;
    parserId: string;
    parserVersion: string;
  }) {
    const repositories = await db.select({ lastHeadSha: sourceRepositories.lastHeadSha })
      .from(sourceRepositories).where(and(
        eq(sourceRepositories.id, input.sourceRepositoryId),
        eq(sourceRepositories.userId, input.userId),
      )).limit(1);
    const basePredicate = and(
      eq(sourceSnapshots.userId, input.userId),
      eq(sourceSnapshots.sourceRepositoryId, input.sourceRepositoryId),
      eq(sourceSnapshots.status, 'ready'),
      eq(sourceSnapshots.parserId, input.parserId),
      eq(sourceSnapshots.parserVersion, input.parserVersion),
    );
    const headSnapshots = repositories[0]?.lastHeadSha
      ? await db.select().from(sourceSnapshots).where(and(
        basePredicate,
        eq(sourceSnapshots.commitSha, repositories[0].lastHeadSha),
      )).limit(1)
      : [];
    const fallbackSnapshots = headSnapshots.length === 0
      ? await db.select().from(sourceSnapshots).where(basePredicate)
        .orderBy(desc(sourceSnapshots.completedAt), desc(sourceSnapshots.createdAt)).limit(1)
      : [];
    const snapshot = headSnapshots[0] || fallbackSnapshots[0];
    if (!snapshot) return null;
    const documents = await db.select().from(sourceDocuments).where(and(
      eq(sourceDocuments.userId, input.userId),
      eq(sourceDocuments.sourceSnapshotId, snapshot.id),
    ));
    return {
      snapshot,
      documents: documents.map((document: typeof sourceDocuments.$inferSelect) => ({
        ...document,
        securityFindings: parseJsonColumn<Array<{ code: string; severity: 'info' | 'warning' | 'blocked' }>>(
          document.securityFindings,
          [],
        ),
        llmEligible: Boolean(document.llmEligible),
      })),
    };
  },

  async completeSyncJob(jobId: string) {
    const jobs = await db.select().from(syncJobs).where(eq(syncJobs.id, jobId)).limit(1);
    if (!jobs[0]) throw new GitHubRepositoryError('SYNC_JOB_NOT_FOUND');
    const now = new Date();
    await Promise.all([
      db.update(syncJobs).set({
        status: 'succeeded', errorCode: null, errorMessage: null,
        nextAttemptAt: null, completedAt: now, updatedAt: now,
      }).where(eq(syncJobs.id, jobId)),
      db.update(sourceConnections).set({
        status: 'active', lastErrorCode: null, lastSyncedAt: now, updatedAt: now,
      }).where(eq(sourceConnections.id, jobs[0].sourceConnectionId)),
    ]);
  },

  async failSyncJob(jobId: string, input: {
    errorCode: string;
    errorMessage?: string | null;
    retryAt?: Date | null;
    connectionStatus?: 'active' | 'suspended' | 'revoked' | 'error';
  }) {
    const jobs = await db.select().from(syncJobs).where(eq(syncJobs.id, jobId)).limit(1);
    if (!jobs[0]) throw new GitHubRepositoryError('SYNC_JOB_NOT_FOUND');
    const now = new Date();
    const retrying = Boolean(input.retryAt);
    await Promise.all([
      db.update(syncJobs).set({
        status: retrying ? 'retrying' : 'failed',
        errorCode: input.errorCode,
        errorMessage: input.errorMessage || null,
        nextAttemptAt: input.retryAt || null,
        completedAt: retrying ? null : now,
        updatedAt: now,
      }).where(eq(syncJobs.id, jobId)),
      db.update(sourceConnections).set({
        status: input.connectionStatus || 'error',
        lastErrorCode: input.errorCode,
        updatedAt: now,
      }).where(eq(sourceConnections.id, jobs[0].sourceConnectionId)),
    ]);
  },

  async recordWebhookDelivery(input: {
    deliveryId: string;
    eventType: string;
    installationId?: string | null;
    repositoryExternalId?: string | null;
    ref?: string | null;
    beforeSha?: string | null;
    afterSha?: string | null;
    payloadHash: string;
  }) {
    const values = {
      deliveryId: input.deliveryId,
      eventType: input.eventType,
      installationId: input.installationId || null,
      repositoryExternalId: input.repositoryExternalId || null,
      ref: input.ref || null,
      beforeSha: input.beforeSha || null,
      afterSha: input.afterSha || null,
      payloadHash: input.payloadHash,
    } satisfies typeof webhookDeliveries.$inferInsert;
    let created: boolean;
    if (config.db.type === 'sqlite') {
      created = db.insert(webhookDeliveries).values(values).onConflictDoNothing().run().changes === 1;
    } else {
      const inserted = await db.insert(webhookDeliveries).values(values).onConflictDoNothing()
        .returning({ deliveryId: webhookDeliveries.deliveryId });
      created = inserted.length === 1;
    }
    const rows = await db.select().from(webhookDeliveries)
      .where(eq(webhookDeliveries.deliveryId, input.deliveryId)).limit(1);
    if (!rows[0] || rows[0].payloadHash !== input.payloadHash) {
      throw new GitHubRepositoryError('WEBHOOK_DELIVERY_CONFLICT');
    }
    return { delivery: rows[0], duplicate: !created };
  },

  async attachWebhookJob(deliveryId: string, jobId: string | null, status: 'ignored' | 'processed' | 'failed', errorCode?: string) {
    await db.update(webhookDeliveries).set({
      syncJobId: jobId,
      status,
      errorCode: errorCode || null,
      processedAt: new Date(),
    }).where(eq(webhookDeliveries.deliveryId, deliveryId));
  },

  async findInstallationByExternalId(installationId: string) {
    const rows = await db.select().from(githubInstallations)
      .where(eq(githubInstallations.installationId, installationId)).limit(1);
    return rows[0] ? serializeInstallation(rows[0]) : null;
  },

  async findSelectedRepositoryByInstallation(installationId: string, externalRepositoryId: string) {
    const installation = await this.findInstallationByExternalId(installationId);
    if (!installation) return null;
    const rows = await db.select().from(sourceRepositories).where(and(
      eq(sourceRepositories.userId, installation.userId),
      eq(sourceRepositories.sourceConnectionId, installation.sourceConnectionId),
      eq(sourceRepositories.externalRepositoryId, externalRepositoryId),
      eq(sourceRepositories.sourceType, 'github'),
      eq(sourceRepositories.selected, true),
    )).limit(1);
    return rows[0] ? { installation, repository: rows[0] } : null;
  },

  async updateConnectionStatusByInstallation(
    installationId: string,
    status: 'active' | 'suspended' | 'revoked' | 'error',
    errorCode: string | null,
  ) {
    const installation = await this.findInstallationByExternalId(installationId);
    if (!installation) return false;
    const now = new Date();
    await Promise.all([
      db.update(sourceConnections).set({ status, lastErrorCode: errorCode, updatedAt: now })
        .where(eq(sourceConnections.id, installation.sourceConnectionId)),
      db.update(githubInstallations).set({
        suspendedAt: status === 'suspended' ? now : status === 'active' ? null : installation.suspendedAt,
        updatedAt: now,
      }).where(eq(githubInstallations.id, installation.id)),
      status === 'revoked'
        ? db.update(sourceRepositories).set({ selected: false, updatedAt: now }).where(and(
          eq(sourceRepositories.userId, installation.userId),
          eq(sourceRepositories.sourceConnectionId, installation.sourceConnectionId),
          eq(sourceRepositories.sourceType, 'github'),
        ))
        : Promise.resolve(),
    ]);
    return true;
  },

  async deselectRepositoriesByInstallation(installationId: string, externalRepositoryIds: string[]) {
    if (externalRepositoryIds.length === 0) return 0;
    const installation = await this.findInstallationByExternalId(installationId);
    if (!installation) return 0;
    const result = await db.update(sourceRepositories).set({
      selected: false,
      updatedAt: new Date(),
    }).where(and(
      eq(sourceRepositories.userId, installation.userId),
      eq(sourceRepositories.sourceConnectionId, installation.sourceConnectionId),
      eq(sourceRepositories.sourceType, 'github'),
      inArray(sourceRepositories.externalRepositoryId, externalRepositoryIds),
    ));
    return Number((result as { changes?: number }).changes || externalRepositoryIds.length);
  },

  async updateRepositoryByInstallation(input: {
    installationId: string;
    externalRepositoryId: string;
    fullName?: string;
    defaultBranch?: string;
    deselect?: boolean;
  }) {
    const installation = await this.findInstallationByExternalId(input.installationId);
    if (!installation) return false;
    const values: Partial<typeof sourceRepositories.$inferInsert> = { updatedAt: new Date() };
    if (input.fullName) values.fullName = input.fullName;
    if (input.defaultBranch) values.defaultBranch = input.defaultBranch;
    if (input.deselect) values.selected = false;
    const predicate = and(
      eq(sourceRepositories.userId, installation.userId),
      eq(sourceRepositories.sourceConnectionId, installation.sourceConnectionId),
      eq(sourceRepositories.sourceType, 'github'),
      eq(sourceRepositories.externalRepositoryId, input.externalRepositoryId),
    );
    if (config.db.type === 'sqlite') {
      return db.update(sourceRepositories).set(values).where(predicate).run().changes === 1;
    }
    const rows = await db.update(sourceRepositories).set(values).where(predicate)
      .returning({ id: sourceRepositories.id });
    return rows.length === 1;
  },
};
