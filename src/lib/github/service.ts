import { createHash, randomBytes } from 'node:crypto';

import type { ActorContext } from '@/lib/auth/service';
import { dbReady } from '@/lib/db';
import { authRepository } from '@/lib/db/repositories/auth.repository';
import {
  GitHubRepositoryError,
  githubRepository,
} from '@/lib/db/repositories/github.repository';

import {
  GitHubApiError,
  GitHubAppClient,
  hasRequiredReadOnlyGitHubPermissions,
} from './client';
import {
  type GitHubAppConfig,
  GitHubConfigError,
  githubInstallationUrl,
  loadGitHubAppConfig,
} from './config';
import type { GitHubInstallation, GitHubInstallationToken, GitHubRepository } from './types';

const CONNECTION_STATE_TTL_MS = 10 * 60 * 1000;
const MAX_SELECTED_REPOSITORIES = 100;

export interface GitHubConnectionApi {
  getInstallation(installationId: string): Promise<GitHubInstallation>;
  createInstallationToken(installationId: string): Promise<GitHubInstallationToken>;
  listInstallationRepositories(token: string): Promise<GitHubRepository[]>;
}

export interface GitHubServiceDependencies {
  config?: GitHubAppConfig;
  client?: GitHubConnectionApi;
  now?: () => Date;
}

export class GitHubServiceError extends Error {
  constructor(
    public readonly code:
      | 'GITHUB_NOT_CONFIGURED'
      | 'INVALID_RETURN_PATH'
      | 'INVALID_CONNECTION_STATE'
      | 'INSTALLATION_NOT_FOUND'
      | 'INSTALLATION_ALREADY_BOUND'
      | 'INSUFFICIENT_APP_PERMISSIONS'
      | 'CONNECTION_NOT_FOUND'
      | 'INVALID_REPOSITORY_SELECTION'
      | 'GITHUB_UNAVAILABLE'
      | 'GITHUB_RATE_LIMITED',
    public readonly status: number,
    public readonly retryAt: Date | null = null,
  ) {
    super(code);
    this.name = 'GitHubServiceError';
  }
}

function dependencies(overrides: GitHubServiceDependencies = {}) {
  let githubConfig: GitHubAppConfig;
  try {
    githubConfig = overrides.config || loadGitHubAppConfig();
  } catch (error) {
    if (error instanceof GitHubConfigError) {
      throw new GitHubServiceError('GITHUB_NOT_CONFIGURED', 503);
    }
    throw error;
  }
  return {
    config: githubConfig,
    client: overrides.client || new GitHubAppClient(githubConfig),
    now: overrides.now || (() => new Date()),
  };
}

function stateHash(state: string): string {
  return `sha256:${createHash('sha256').update(state).digest('hex')}`;
}

function safeReturnPath(value?: string): string {
  const requested = value || '/zh/knowledge';
  let parsed: URL;
  try {
    parsed = new URL(requested, 'https://jadeai.invalid');
  } catch {
    throw new GitHubServiceError('INVALID_RETURN_PATH', 400);
  }
  if (parsed.origin !== 'https://jadeai.invalid'
    || !/^\/(?:zh|en)\/knowledge$/.test(parsed.pathname)
    || parsed.hash) {
    throw new GitHubServiceError('INVALID_RETURN_PATH', 400);
  }
  return `${parsed.pathname}${parsed.search}`;
}

function assertReadOnlyPermissions(installation: GitHubInstallation): void {
  if (!hasRequiredReadOnlyGitHubPermissions(installation.permissions)) {
    throw new GitHubServiceError('INSUFFICIENT_APP_PERMISSIONS', 422);
  }
}

function installationToken(token: GitHubInstallationToken): string {
  if (!hasRequiredReadOnlyGitHubPermissions(token.permissions)) {
    throw new GitHubServiceError('INSUFFICIENT_APP_PERMISSIONS', 422);
  }
  return token.token;
}

function mapError(error: unknown): never {
  if (error instanceof GitHubServiceError) throw error;
  if (error instanceof GitHubRepositoryError) {
    switch (error.code) {
      case 'CONNECTION_NOT_FOUND':
        throw new GitHubServiceError('CONNECTION_NOT_FOUND', 404);
      case 'INSTALLATION_NOT_FOUND':
        throw new GitHubServiceError('INSTALLATION_NOT_FOUND', 404);
      case 'INSTALLATION_ALREADY_BOUND':
        throw new GitHubServiceError('INSTALLATION_ALREADY_BOUND', 409);
      default:
        throw new GitHubServiceError('GITHUB_UNAVAILABLE', 502);
    }
  }
  if (error instanceof GitHubApiError) {
    if (error.code === 'INSTALLATION_NOT_FOUND') {
      throw new GitHubServiceError('INSTALLATION_NOT_FOUND', 404);
    }
    if (error.code === 'RATE_LIMITED') {
      throw new GitHubServiceError('GITHUB_RATE_LIMITED', 429, error.retryAt);
    }
    throw new GitHubServiceError('GITHUB_UNAVAILABLE', error.status >= 500 ? 502 : error.status);
  }
  throw error;
}

async function writeAudit(
  actor: ActorContext,
  action: string,
  targetId: string | null,
  metadata: Record<string, unknown> = {},
) {
  await authRepository.writeAudit({
    actorUserId: actor.userId,
    action,
    targetType: 'github_connection',
    targetId,
    outcome: 'success',
    requestId: actor.requestId,
    metadata,
  });
}

export const githubConnectionService = {
  async startConnection(
    actor: ActorContext,
    input: { returnPath?: string } = {},
    overrides: GitHubServiceDependencies = {},
  ) {
    await dbReady;
    const deps = dependencies(overrides);
    const state = randomBytes(32).toString('base64url');
    const returnPath = safeReturnPath(input.returnPath);
    const expiresAt = new Date(deps.now().getTime() + CONNECTION_STATE_TTL_MS);
    const created = await githubRepository.createConnectionStateOwned({
      userId: actor.userId,
      stateHash: stateHash(state),
      returnPath,
      expiresAt,
    });
    await writeAudit(actor, 'github.connection_started', created.connectionId);
    return {
      connectionId: created.connectionId,
      installationUrl: githubInstallationUrl(deps.config, state),
      expiresAt,
    };
  },

  async completeConnection(
    actor: ActorContext,
    input: { state: string; installationId: string },
    overrides: GitHubServiceDependencies = {},
  ) {
    await dbReady;
    const deps = dependencies(overrides);
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(input.state) || !/^\d{1,30}$/.test(input.installationId)) {
      throw new GitHubServiceError('INVALID_CONNECTION_STATE', 400);
    }
    const consumed = await githubRepository.consumeConnectionStateOwned(
      actor.userId,
      stateHash(input.state),
      deps.now(),
    );
    if (!consumed) throw new GitHubServiceError('INVALID_CONNECTION_STATE', 400);
    try {
      const installation = await deps.client.getInstallation(input.installationId);
      if (installation.id !== input.installationId || installation.suspendedAt) {
        throw new GitHubServiceError('INSTALLATION_NOT_FOUND', 404);
      }
      assertReadOnlyPermissions(installation);
      const bound = await githubRepository.bindInstallationOwned({
        userId: actor.userId,
        sourceConnectionId: consumed.sourceConnectionId,
        installation,
      });
      await writeAudit(actor, 'github.connection_completed', consumed.sourceConnectionId, {
        installationId: installation.id,
        accountId: installation.account.id,
        accountType: installation.account.type,
      });
      return { connection: bound!, returnPath: consumed.returnPath };
    } catch (error) {
      mapError(error);
    }
  },

  async listConnections(actor: ActorContext) {
    await dbReady;
    return githubRepository.listConnectionsOwned(actor.userId);
  },

  async listRepositories(
    actor: ActorContext,
    sourceConnectionId: string,
    overrides: GitHubServiceDependencies = {},
  ) {
    await dbReady;
    const deps = dependencies(overrides);
    try {
      const installation = await githubRepository.findInstallationOwned(actor.userId, sourceConnectionId);
      if (!installation) throw new GitHubServiceError('CONNECTION_NOT_FOUND', 404);
      // The installation access token intentionally remains scoped to this call and is never
      // returned by the service or handed to a repository persistence method.
      const token = installationToken(
        await deps.client.createInstallationToken(installation.installationId),
      );
      const accessible = await deps.client.listInstallationRepositories(token);
      const connections = await githubRepository.listConnectionsOwned(actor.userId);
      const selectedIds = new Set(
        connections.find((connection: { id: string }) => connection.id === sourceConnectionId)?.repositories
          .filter((repository: { selected: boolean }) => repository.selected)
          .map((repository: { externalRepositoryId: string }) => repository.externalRepositoryId) || [],
      );
      return accessible.map((repository) => ({
        ...repository,
        selected: selectedIds.has(repository.id),
      }));
    } catch (error) {
      mapError(error);
    }
  },

  async selectRepositories(
    actor: ActorContext,
    sourceConnectionId: string,
    repositoryIds: string[],
    overrides: GitHubServiceDependencies = {},
  ) {
    await dbReady;
    const uniqueIds = [...new Set(repositoryIds)];
    if (uniqueIds.length > MAX_SELECTED_REPOSITORIES
      || uniqueIds.some((id) => !/^\d{1,30}$/.test(id))) {
      throw new GitHubServiceError('INVALID_REPOSITORY_SELECTION', 400);
    }
    const deps = dependencies(overrides);
    try {
      const installation = await githubRepository.findInstallationOwned(actor.userId, sourceConnectionId);
      if (!installation) throw new GitHubServiceError('CONNECTION_NOT_FOUND', 404);
      const token = installationToken(
        await deps.client.createInstallationToken(installation.installationId),
      );
      const accessible = await deps.client.listInstallationRepositories(token);
      const byId = new Map(accessible.map((repository) => [repository.id, repository]));
      const selected = uniqueIds.map((id) => byId.get(id));
      if (selected.some((repository) => !repository || repository.archived || repository.disabled)) {
        throw new GitHubServiceError('INVALID_REPOSITORY_SELECTION', 422);
      }
      const rows = await githubRepository.replaceSelectedRepositoriesOwned({
        userId: actor.userId,
        sourceConnectionId,
        selected: selected as GitHubRepository[],
      });
      await writeAudit(actor, 'github.repositories_selected', sourceConnectionId, {
        repositoryIds: uniqueIds,
      });
      return rows.map((row: { selected: unknown }) => ({ ...row, selected: Boolean(row.selected) }));
    } catch (error) {
      mapError(error);
    }
  },
};
