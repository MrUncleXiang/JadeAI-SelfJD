import type { ActorContext } from '@/lib/auth/service';
import { hashOpaqueToken } from '@/lib/auth/tokens';
import { dbReady } from '@/lib/db';
import { authRepository } from '@/lib/db/repositories/auth.repository';
import {
  GitHubPatRepositoryError,
  githubPatRepository,
} from '@/lib/db/repositories/github-pat.repository';
import { LlmEncryptionError } from '@/lib/llm/encryption';

import { GitHubApiError, GitHubPatClient } from './client';
import { decryptGitHubPat, encryptGitHubPat, isFineGrainedGitHubPat } from './pat-token';
import type { GitHubAuthenticatedUser, GitHubRepository } from './types';

const MAX_SELECTED_REPOSITORIES = 100;

export interface GitHubPatConnectionApi {
  getAuthenticatedUser(): Promise<GitHubAuthenticatedUser>;
  listRepositories(): Promise<GitHubRepository[]>;
}

export interface GitHubPatServiceDependencies {
  client?: GitHubPatConnectionApi;
}

export class GitHubPatServiceError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_PAT_FORMAT'
      | 'INVALID_PAT'
      | 'PAT_INSUFFICIENT_PERMISSIONS'
      | 'PAT_REVOKED'
      | 'PAT_ENCRYPTION_UNAVAILABLE'
      | 'CONNECTION_NOT_FOUND'
      | 'INVALID_REPOSITORY_SELECTION'
      | 'GITHUB_RATE_LIMITED'
      | 'GITHUB_UNAVAILABLE'
      | 'TOO_MANY_ATTEMPTS',
    public readonly status: number,
    public readonly retryAt: Date | null = null,
  ) {
    super(code);
    this.name = 'GitHubPatServiceError';
  }
}

function clientFor(token: string, overrides: GitHubPatServiceDependencies) {
  return overrides.client || new GitHubPatClient(token);
}

function mapError(error: unknown, existingConnection = false): GitHubPatServiceError {
  if (error instanceof GitHubPatServiceError) return error;
  if (error instanceof LlmEncryptionError) {
    return new GitHubPatServiceError('PAT_ENCRYPTION_UNAVAILABLE', 503);
  }
  if (error instanceof GitHubPatRepositoryError) {
    if (error.code === 'CONNECTION_NOT_FOUND') {
      return new GitHubPatServiceError('CONNECTION_NOT_FOUND', 404);
    }
    return new GitHubPatServiceError('INVALID_REPOSITORY_SELECTION', 422);
  }
  if (error instanceof GitHubApiError) {
    if (error.code === 'AUTH_FAILED') {
      return new GitHubPatServiceError(existingConnection ? 'PAT_REVOKED' : 'INVALID_PAT', 401);
    }
    if (error.code === 'PERMISSION_DENIED') {
      return new GitHubPatServiceError('PAT_INSUFFICIENT_PERMISSIONS', 422);
    }
    if (error.code === 'RATE_LIMITED') {
      return new GitHubPatServiceError('GITHUB_RATE_LIMITED', 429, error.retryAt);
    }
    return new GitHubPatServiceError('GITHUB_UNAVAILABLE', 502);
  }
  return new GitHubPatServiceError('GITHUB_UNAVAILABLE', 500);
}

async function writeAudit(
  actor: ActorContext,
  action: string,
  targetId: string | null,
  outcome: 'success' | 'failure',
  metadata: Record<string, unknown> = {},
) {
  await authRepository.writeAudit({
    actorUserId: actor.userId,
    action,
    targetType: 'github_pat_connection',
    targetId,
    outcome,
    requestId: actor.requestId,
    metadata,
  });
}

async function consumeConnectionRateLimit(actor: ActorContext) {
  const rateLimit = await authRepository.consumeRateLimit({
    keyHash: hashOpaqueToken(`github.pat-connect\0${actor.userId}`),
    scope: 'github.pat-connect',
    maxAttempts: 10,
    windowMs: 15 * 60 * 1000,
    blockMs: 15 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    throw new GitHubPatServiceError(
      'TOO_MANY_ATTEMPTS',
      429,
      new Date(Date.now() + rateLimit.retryAfterSeconds * 1000),
    );
  }
}

async function tokenForConnection(userId: string, connectionId: string) {
  const connection = await githubPatRepository.findConnectionOwned(userId, connectionId);
  if (!connection || connection.status !== 'active') {
    throw new GitHubPatServiceError('CONNECTION_NOT_FOUND', 404);
  }
  const credential = await githubPatRepository.findCredentialOwned(userId, connectionId);
  if (!credential) throw new GitHubPatServiceError('PAT_REVOKED', 401);
  return decryptGitHubPat({
    ciphertext: credential.encryptedToken,
    iv: credential.tokenIv,
    tag: credential.tokenTag,
    keyVersion: credential.keyVersion,
  }, { userId, connectionId });
}

async function markExistingConnectionFailure(
  userId: string,
  connectionId: string,
  error: GitHubPatServiceError,
) {
  if (error.code === 'PAT_REVOKED') {
    await githubPatRepository.revokeConnectionOwned(userId, connectionId);
  } else if (['PAT_INSUFFICIENT_PERMISSIONS', 'PAT_ENCRYPTION_UNAVAILABLE'].includes(error.code)) {
    await githubPatRepository.updateConnectionStatusOwned({
      userId,
      connectionId,
      status: 'error',
      errorCode: error.code,
    });
  }
}

export const githubPatService = {
  async listConnections(actor: ActorContext) {
    await dbReady;
    return githubPatRepository.listConnectionsOwned(actor.userId);
  },

  async createConnection(
    actor: ActorContext,
    input: { label?: string; token: string },
    overrides: GitHubPatServiceDependencies = {},
  ) {
    await dbReady;
    if (!isFineGrainedGitHubPat(input.token)) {
      throw new GitHubPatServiceError('INVALID_PAT_FORMAT', 400);
    }
    await consumeConnectionRateLimit(actor);
    const connectionId = crypto.randomUUID();
    try {
      const client = clientFor(input.token, overrides);
      const account = await client.getAuthenticatedUser();
      const repositories = await client.listRepositories();
      const encrypted = encryptGitHubPat(input.token, {
        userId: actor.userId,
        connectionId,
      });
      const label = input.label?.trim() || `${account.login} PAT`;
      const connection = await githubPatRepository.createConnectionOwned({
        id: connectionId,
        userId: actor.userId,
        label,
        accountId: account.id,
        accountLogin: account.login,
        encrypted,
      });
      await writeAudit(actor, 'github.pat_connection_created', connectionId, 'success', {
        accountId: account.id,
        accessibleRepositoryCount: repositories.length,
      });
      return connection!;
    } catch (error) {
      const mapped = mapError(error);
      await writeAudit(actor, 'github.pat_connection_created', null, 'failure', {
        errorCode: mapped.code,
      });
      throw mapped;
    }
  },

  async listRepositories(
    actor: ActorContext,
    connectionId: string,
    overrides: GitHubPatServiceDependencies = {},
  ) {
    await dbReady;
    try {
      const token = await tokenForConnection(actor.userId, connectionId);
      const repositories = await clientFor(token, overrides).listRepositories();
      const selectedIds = await githubPatRepository.selectedRepositoryIdsOwned(
        actor.userId,
        connectionId,
      );
      return repositories.map((repository) => ({
        ...repository,
        selected: selectedIds.has(repository.id),
      }));
    } catch (error) {
      const mapped = mapError(error, true);
      await markExistingConnectionFailure(actor.userId, connectionId, mapped);
      throw mapped;
    }
  },

  async selectRepositories(
    actor: ActorContext,
    connectionId: string,
    repositoryIds: string[],
    overrides: GitHubPatServiceDependencies = {},
  ) {
    await dbReady;
    const uniqueIds = [...new Set(repositoryIds)];
    if (uniqueIds.length > MAX_SELECTED_REPOSITORIES
      || uniqueIds.some((id) => !/^\d{1,30}$/.test(id))) {
      throw new GitHubPatServiceError('INVALID_REPOSITORY_SELECTION', 400);
    }
    try {
      const token = await tokenForConnection(actor.userId, connectionId);
      const accessible = await clientFor(token, overrides).listRepositories();
      const byId = new Map(accessible.map((repository) => [repository.id, repository]));
      const selected = uniqueIds.map((id) => byId.get(id));
      if (selected.some((repository) => !repository || repository.archived || repository.disabled)) {
        throw new GitHubPatServiceError('INVALID_REPOSITORY_SELECTION', 422);
      }
      const rows = await githubPatRepository.replaceSelectedRepositoriesOwned({
        userId: actor.userId,
        sourceConnectionId: connectionId,
        selected: selected as GitHubRepository[],
      });
      await writeAudit(actor, 'github.pat_repositories_selected', connectionId, 'success', {
        repositoryIds: uniqueIds,
      });
      return rows.map((row: (typeof rows)[number]) => ({
        ...row,
        selected: Boolean(row.selected),
      }));
    } catch (error) {
      const mapped = mapError(error, true);
      await markExistingConnectionFailure(actor.userId, connectionId, mapped);
      await writeAudit(actor, 'github.pat_repositories_selected', connectionId, 'failure', {
        errorCode: mapped.code,
      });
      throw mapped;
    }
  },

  async revokeConnection(actor: ActorContext, connectionId: string) {
    await dbReady;
    const revoked = await githubPatRepository.revokeConnectionOwned(actor.userId, connectionId);
    if (!revoked) throw new GitHubPatServiceError('CONNECTION_NOT_FOUND', 404);
    await writeAudit(actor, 'github.pat_connection_revoked', connectionId, 'success');
  },
};
