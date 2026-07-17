import { and, desc, eq } from 'drizzle-orm';

import { config } from '@/lib/config';
import type { GitHubRepository } from '@/lib/github/types';
import type { EncryptedSecret } from '@/lib/llm/encryption';

import { db } from '../index';
import {
  githubPatCredentials,
  sourceConnections,
  sourceRepositories,
  syncJobs,
} from '../schema';

type ConnectionRow = typeof sourceConnections.$inferSelect;
type RepositoryRow = typeof sourceRepositories.$inferSelect;
type SyncJobRow = typeof syncJobs.$inferSelect;
type CredentialListRow = Pick<
  typeof githubPatCredentials.$inferSelect,
  'sourceConnectionId' | 'label' | 'accountId' | 'accountLogin'
>;

export type GitHubPatConnectionListItem = ConnectionRow & {
  credential: CredentialListRow | null;
  repositories: Array<RepositoryRow & { selected: boolean }>;
  recentJobs: SyncJobRow[];
};

export class GitHubPatRepositoryError extends Error {
  constructor(public readonly code:
    | 'CONNECTION_NOT_FOUND'
    | 'REPOSITORY_NOT_FOUND'
  ) {
    super(code);
    this.name = 'GitHubPatRepositoryError';
  }
}

function connectionPredicate(userId: string, connectionId: string) {
  return and(
    eq(sourceConnections.id, connectionId),
    eq(sourceConnections.userId, userId),
    eq(sourceConnections.provider, 'github-pat'),
  );
}

export const githubPatRepository = {
  async createConnectionOwned(input: {
    id: string;
    userId: string;
    label: string;
    accountId: string;
    accountLogin: string;
    encrypted: EncryptedSecret;
  }) {
    const connection = {
      id: input.id,
      userId: input.userId,
      provider: 'github-pat' as const,
      status: 'active' as const,
    } satisfies typeof sourceConnections.$inferInsert;
    const credential = {
      id: crypto.randomUUID(),
      userId: input.userId,
      sourceConnectionId: input.id,
      label: input.label,
      accountId: input.accountId,
      accountLogin: input.accountLogin,
      encryptedToken: input.encrypted.ciphertext,
      tokenIv: input.encrypted.iv,
      tokenTag: input.encrypted.tag,
      keyVersion: input.encrypted.keyVersion,
    } satisfies typeof githubPatCredentials.$inferInsert;
    if (config.db.type === 'sqlite') {
      db.transaction((tx: typeof db) => {
        tx.insert(sourceConnections).values(connection).run();
        tx.insert(githubPatCredentials).values(credential).run();
      });
    } else {
      await db.transaction(async (tx: typeof db) => {
        await tx.insert(sourceConnections).values(connection);
        await tx.insert(githubPatCredentials).values(credential);
      });
    }
    return this.findConnectionOwned(input.userId, input.id);
  },

  async findConnectionOwned(userId: string, connectionId: string) {
    const rows = await db.select().from(sourceConnections)
      .where(connectionPredicate(userId, connectionId)).limit(1);
    return rows[0] || null;
  },

  async findCredentialOwned(userId: string, connectionId: string) {
    const rows = await db.select().from(githubPatCredentials).where(and(
      eq(githubPatCredentials.userId, userId),
      eq(githubPatCredentials.sourceConnectionId, connectionId),
    )).limit(1);
    return rows[0] || null;
  },

  async listConnectionsOwned(userId: string): Promise<GitHubPatConnectionListItem[]> {
    const [connections, credentials, repositories, jobs] = await Promise.all([
      db.select().from(sourceConnections).where(and(
        eq(sourceConnections.userId, userId),
        eq(sourceConnections.provider, 'github-pat'),
      )).orderBy(desc(sourceConnections.createdAt)),
      db.select({
        sourceConnectionId: githubPatCredentials.sourceConnectionId,
        label: githubPatCredentials.label,
        accountId: githubPatCredentials.accountId,
        accountLogin: githubPatCredentials.accountLogin,
      }).from(githubPatCredentials).where(eq(githubPatCredentials.userId, userId)),
      db.select().from(sourceRepositories).where(and(
        eq(sourceRepositories.userId, userId),
        eq(sourceRepositories.sourceType, 'github-pat'),
      )),
      db.select().from(syncJobs).where(eq(syncJobs.userId, userId))
        .orderBy(desc(syncJobs.createdAt)),
    ]);
    return connections.map((connection: ConnectionRow) => ({
      ...connection,
      credential: credentials.find(
        (row: CredentialListRow) => row.sourceConnectionId === connection.id,
      ) || null,
      repositories: repositories.filter(
        (row: RepositoryRow) => row.sourceConnectionId === connection.id,
      ).map((row: RepositoryRow) => ({ ...row, selected: Boolean(row.selected) })),
      recentJobs: jobs.filter(
        (row: SyncJobRow) => row.sourceConnectionId === connection.id,
      ).slice(0, 10),
    }));
  },

  async selectedRepositoryIdsOwned(userId: string, connectionId: string): Promise<Set<string>> {
    const rows = await db.select({ externalRepositoryId: sourceRepositories.externalRepositoryId })
      .from(sourceRepositories).where(and(
        eq(sourceRepositories.userId, userId),
        eq(sourceRepositories.sourceConnectionId, connectionId),
        eq(sourceRepositories.sourceType, 'github-pat'),
        eq(sourceRepositories.selected, true),
      ));
    return new Set(rows.map(
      (row: Pick<RepositoryRow, 'externalRepositoryId'>) => row.externalRepositoryId,
    ));
  },

  async replaceSelectedRepositoriesOwned(input: {
    userId: string;
    sourceConnectionId: string;
    selected: GitHubRepository[];
  }): Promise<Array<RepositoryRow & { selected: boolean }>> {
    const repositoryValues = (repository: GitHubRepository) => ({
      id: crypto.randomUUID(),
      userId: input.userId,
      sourceType: 'github-pat' as const,
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
        const connection = tx.select().from(sourceConnections)
          .where(connectionPredicate(input.userId, input.sourceConnectionId)).limit(1).get();
        const credential = tx.select().from(githubPatCredentials).where(and(
          eq(githubPatCredentials.userId, input.userId),
          eq(githubPatCredentials.sourceConnectionId, input.sourceConnectionId),
        )).limit(1).get();
        if (!connection || connection.status !== 'active' || !credential) {
          throw new GitHubPatRepositoryError('CONNECTION_NOT_FOUND');
        }
        tx.update(sourceRepositories).set({ selected: false, updatedAt: new Date() }).where(and(
          eq(sourceRepositories.userId, input.userId),
          eq(sourceRepositories.sourceType, 'github-pat'),
          eq(sourceRepositories.sourceConnectionId, input.sourceConnectionId),
        )).run();
        for (const repository of input.selected) {
          tx.insert(sourceRepositories).values(repositoryValues(repository)).onConflictDoNothing().run();
          tx.update(sourceRepositories).set(repositoryUpdate(repository)).where(and(
            eq(sourceRepositories.userId, input.userId),
            eq(sourceRepositories.sourceType, 'github-pat'),
            eq(sourceRepositories.externalRepositoryId, repository.id),
          )).run();
        }
      });
    } else {
      await db.transaction(async (tx: typeof db) => {
        const connections = await tx.select().from(sourceConnections)
          .where(connectionPredicate(input.userId, input.sourceConnectionId)).limit(1);
        const credentials = await tx.select({ id: githubPatCredentials.id })
          .from(githubPatCredentials).where(and(
            eq(githubPatCredentials.userId, input.userId),
            eq(githubPatCredentials.sourceConnectionId, input.sourceConnectionId),
          )).limit(1);
        if (!connections[0] || connections[0].status !== 'active' || !credentials[0]) {
          throw new GitHubPatRepositoryError('CONNECTION_NOT_FOUND');
        }
        await tx.update(sourceRepositories).set({ selected: false, updatedAt: new Date() }).where(and(
          eq(sourceRepositories.userId, input.userId),
          eq(sourceRepositories.sourceType, 'github-pat'),
          eq(sourceRepositories.sourceConnectionId, input.sourceConnectionId),
        ));
        for (const repository of input.selected) {
          await tx.insert(sourceRepositories).values(repositoryValues(repository)).onConflictDoNothing();
          await tx.update(sourceRepositories).set(repositoryUpdate(repository)).where(and(
            eq(sourceRepositories.userId, input.userId),
            eq(sourceRepositories.sourceType, 'github-pat'),
            eq(sourceRepositories.externalRepositoryId, repository.id),
          ));
        }
      });
    }
    const rows = await db.select().from(sourceRepositories).where(and(
      eq(sourceRepositories.userId, input.userId),
      eq(sourceRepositories.sourceType, 'github-pat'),
      eq(sourceRepositories.sourceConnectionId, input.sourceConnectionId),
    ));
    return rows.map((row: RepositoryRow) => ({ ...row, selected: Boolean(row.selected) }));
  },

  async updateConnectionStatusOwned(input: {
    userId: string;
    connectionId: string;
    status: 'active' | 'revoked' | 'error';
    errorCode: string | null;
    deselect?: boolean;
  }) {
    const connection = await this.findConnectionOwned(input.userId, input.connectionId);
    if (!connection) return false;
    const now = new Date();
    await db.update(sourceConnections).set({
      status: input.status,
      lastErrorCode: input.errorCode,
      updatedAt: now,
    }).where(connectionPredicate(input.userId, input.connectionId));
    if (input.deselect) {
      await db.update(sourceRepositories).set({ selected: false, updatedAt: now }).where(and(
        eq(sourceRepositories.userId, input.userId),
        eq(sourceRepositories.sourceType, 'github-pat'),
        eq(sourceRepositories.sourceConnectionId, input.connectionId),
      ));
    }
    return true;
  },

  async revokeConnectionOwned(userId: string, connectionId: string) {
    const connection = await this.findConnectionOwned(userId, connectionId);
    if (!connection) return false;
    const now = new Date();
    if (config.db.type === 'sqlite') {
      db.transaction((tx: typeof db) => {
        tx.update(sourceRepositories).set({ selected: false, updatedAt: now }).where(and(
          eq(sourceRepositories.userId, userId),
          eq(sourceRepositories.sourceType, 'github-pat'),
          eq(sourceRepositories.sourceConnectionId, connectionId),
        )).run();
        tx.delete(githubPatCredentials).where(and(
          eq(githubPatCredentials.userId, userId),
          eq(githubPatCredentials.sourceConnectionId, connectionId),
        )).run();
        tx.update(sourceConnections).set({
          status: 'revoked',
          lastErrorCode: 'PAT_REVOKED',
          updatedAt: now,
        }).where(connectionPredicate(userId, connectionId)).run();
      });
    } else {
      await db.transaction(async (tx: typeof db) => {
        await tx.update(sourceRepositories).set({ selected: false, updatedAt: now }).where(and(
          eq(sourceRepositories.userId, userId),
          eq(sourceRepositories.sourceType, 'github-pat'),
          eq(sourceRepositories.sourceConnectionId, connectionId),
        ));
        await tx.delete(githubPatCredentials).where(and(
          eq(githubPatCredentials.userId, userId),
          eq(githubPatCredentials.sourceConnectionId, connectionId),
        ));
        await tx.update(sourceConnections).set({
          status: 'revoked',
          lastErrorCode: 'PAT_REVOKED',
          updatedAt: now,
        }).where(connectionPredicate(userId, connectionId));
      });
    }
    return true;
  },
};
