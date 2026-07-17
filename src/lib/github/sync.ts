import type { ActorContext } from '@/lib/auth/service';
import {
  WORKRESUME_PARSER_ID,
  WORKRESUME_PARSER_LABEL,
  WORKRESUME_PARSER_VERSION,
  WorkResumeImportError,
  parseWorkResumeV2Documents,
} from '@/lib/career/workresume-v2';
import type { SourceDocumentImportInput } from '@/lib/career/types';
import { dbReady } from '@/lib/db';
import { authRepository } from '@/lib/db/repositories/auth.repository';
import { careerRepository } from '@/lib/db/repositories/career.repository';
import {
  GitHubRepositoryError,
  githubRepository,
} from '@/lib/db/repositories/github.repository';

import {
  decodeAndVerifyGitHubBlob,
  GitHubApiError,
  GitHubAppClient,
  hasRequiredReadOnlyGitHubPermissions,
} from './client';
import { type GitHubAppConfig, GitHubConfigError, loadGitHubAppConfig } from './config';
import { filterGitHubTree, githubDocumentMimeType, inspectGitHubDocument } from './security';
import type {
  GitHubBlob,
  GitHubCommit,
  GitHubInstallationToken,
  GitHubRepository,
  GitHubTree,
} from './types';

const MAX_FETCHED_DOCUMENTS = 500;
const MAX_FETCHED_BYTES = 12 * 1024 * 1024;
const MAX_RECORDED_IGNORED_DOCUMENTS = 1_000;
const MAX_TRANSIENT_SYNC_ATTEMPTS = 3;
const DEFAULT_RATE_LIMIT_RETRY_MS = 5 * 60 * 1000;

export interface GitHubSyncApi {
  createInstallationToken(installationId: string): Promise<GitHubInstallationToken>;
  getRepository(token: string, repositoryId: string): Promise<GitHubRepository>;
  getCommit(token: string, fullName: string, ref: string): Promise<GitHubCommit>;
  getTree(token: string, fullName: string, treeSha: string): Promise<GitHubTree>;
  getBlob(token: string, fullName: string, blobSha: string): Promise<GitHubBlob>;
}

export interface GitHubSyncDependencies {
  config?: GitHubAppConfig;
  client?: GitHubSyncApi;
}

export class GitHubSyncError extends Error {
  constructor(
    public readonly code:
      | 'GITHUB_NOT_CONFIGURED'
      | 'INSUFFICIENT_APP_PERMISSIONS'
      | 'REPOSITORY_NOT_FOUND'
      | 'REPOSITORY_INACCESSIBLE'
      | 'INSTALLATION_REVOKED'
      | 'GITHUB_RATE_LIMITED'
      | 'REPOSITORY_TOO_LARGE'
      | 'UNSUPPORTED_LAYOUT'
      | 'SECRET_DETECTED'
      | 'PARSER_VALIDATION_FAILED'
      | 'SYNC_FAILED',
    public readonly status: number,
    public readonly retryAt: Date | null = null,
  ) {
    super(code);
    this.name = 'GitHubSyncError';
  }
}

function dependencies(overrides: GitHubSyncDependencies = {}) {
  let githubConfig: GitHubAppConfig;
  try {
    githubConfig = overrides.config || loadGitHubAppConfig();
  } catch (error) {
    if (error instanceof GitHubConfigError) {
      throw new GitHubSyncError('GITHUB_NOT_CONFIGURED', 503);
    }
    throw error;
  }
  return {
    client: overrides.client || new GitHubAppClient(githubConfig),
  };
}

function isCommitSha(value: string): boolean {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value);
}

function idempotencyKey(sourceRepositoryId: string, commitSha: string): string {
  return `github:${sourceRepositoryId}:${commitSha.toLowerCase()}:${WORKRESUME_PARSER_LABEL}`;
}

function mapSyncError(error: unknown): GitHubSyncError {
  if (error instanceof GitHubSyncError) return error;
  if (error instanceof GitHubApiError) {
    if (error.code === 'RATE_LIMITED') {
      return new GitHubSyncError('GITHUB_RATE_LIMITED', 429, error.retryAt);
    }
    if (error.code === 'AUTH_FAILED' || error.code === 'INSTALLATION_NOT_FOUND') {
      return new GitHubSyncError('INSTALLATION_REVOKED', 401);
    }
    if (error.code === 'REPOSITORY_NOT_FOUND' || error.code === 'PERMISSION_DENIED') {
      return new GitHubSyncError('REPOSITORY_INACCESSIBLE', error.status);
    }
    if (error.code === 'RESPONSE_TOO_LARGE' || error.code === 'TREE_TRUNCATED') {
      return new GitHubSyncError('REPOSITORY_TOO_LARGE', 422);
    }
    return new GitHubSyncError('SYNC_FAILED', 502);
  }
  if (error instanceof WorkResumeImportError) {
    if (error.code === 'SECRET_FILE_BLOCKED') return new GitHubSyncError('SECRET_DETECTED', 422);
    if (['CONFIG_NOT_FOUND', 'INVALID_CONFIG', 'INVALID_CAPABILITY_POOL'].includes(error.code)) {
      return new GitHubSyncError('UNSUPPORTED_LAYOUT', 422);
    }
    if (['FILE_TOO_LARGE', 'IMPORT_TOO_LARGE', 'TOO_MANY_DOCUMENTS'].includes(error.code)) {
      return new GitHubSyncError('REPOSITORY_TOO_LARGE', 422);
    }
    return new GitHubSyncError('PARSER_VALIDATION_FAILED', 422);
  }
  if (error instanceof GitHubRepositoryError) {
    if (error.code === 'REPOSITORY_NOT_FOUND') return new GitHubSyncError('REPOSITORY_NOT_FOUND', 404);
    if (error.code === 'INSTALLATION_NOT_FOUND') return new GitHubSyncError('INSTALLATION_REVOKED', 401);
  }
  return new GitHubSyncError('SYNC_FAILED', 500);
}

function reusableDocument(
  path: string,
  blobSha: string,
  previous: {
    contentHash: string;
    mimeType: string;
    sizeBytes: number;
    textContent: string | null;
    parseStatus: 'ready' | 'ignored' | 'failed';
    securityFindings: Array<{ code: string; severity: 'info' | 'warning' | 'blocked' }>;
    llmEligible: boolean;
  },
): SourceDocumentImportInput {
  return {
    path,
    blobSha,
    contentHash: previous.contentHash,
    mimeType: githubDocumentMimeType(path),
    sizeBytes: previous.sizeBytes,
    textContent: previous.textContent,
    parseStatus: previous.parseStatus,
    securityFindings: previous.securityFindings,
    llmEligible: previous.llmEligible,
  };
}

function failureConnectionStatus(error: GitHubSyncError) {
  if (error.code === 'INSTALLATION_REVOKED') return 'revoked' as const;
  if (['GITHUB_NOT_CONFIGURED', 'INSUFFICIENT_APP_PERMISSIONS'].includes(error.code)) return 'error' as const;
  // A repository/parser/network failure must not disable every repository on the same
  // installation. Keep the connection usable so the user or reconciler can retry/manage it.
  return 'active' as const;
}

function retryAtForFailure(error: GitHubSyncError, attemptCount: number, now = new Date()): Date | null {
  if (error.retryAt) return error.retryAt;
  if (error.code === 'GITHUB_RATE_LIMITED') {
    return new Date(now.getTime() + DEFAULT_RATE_LIMIT_RETRY_MS);
  }
  if (error.code === 'SYNC_FAILED' && attemptCount < MAX_TRANSIENT_SYNC_ATTEMPTS) {
    const delay = 30_000 * (2 ** Math.max(0, attemptCount - 1));
    return new Date(now.getTime() + delay);
  }
  return null;
}

function installationToken(value: GitHubInstallationToken): string {
  if (!hasRequiredReadOnlyGitHubPermissions(value.permissions)) {
    throw new GitHubSyncError('INSUFFICIENT_APP_PERMISSIONS', 422);
  }
  return value.token;
}

export async function enqueueKnownGitHubCommit(input: {
  userId: string;
  sourceConnectionId: string;
  sourceRepositoryId: string;
  commitSha: string;
  trigger: 'initial' | 'manual' | 'webhook' | 'scheduled';
  requestId?: string | null;
  webhookDeliveryId?: string | null;
}) {
  if (!isCommitSha(input.commitSha)) throw new GitHubSyncError('SYNC_FAILED', 400);
  return githubRepository.enqueueSyncJobOwned({
    userId: input.userId,
    sourceConnectionId: input.sourceConnectionId,
    sourceRepositoryId: input.sourceRepositoryId,
    trigger: input.trigger,
    idempotencyKey: idempotencyKey(input.sourceRepositoryId, input.commitSha),
    requestedCommitSha: input.commitSha.toLowerCase(),
    requestId: input.requestId,
    webhookDeliveryId: input.webhookDeliveryId,
  });
}

async function enqueueRepositoryOwned(
  input: {
    userId: string;
    requestId: string | null;
    sourceRepositoryId: string;
    trigger: 'initial' | 'manual' | 'scheduled';
  },
  overrides: GitHubSyncDependencies = {},
) {
  const deps = dependencies(overrides);
  try {
    const repository = await githubRepository.findRepositoryOwned(input.userId, input.sourceRepositoryId);
    if (!repository?.selected || !repository.sourceConnectionId) {
      throw new GitHubSyncError('REPOSITORY_NOT_FOUND', 404);
    }
    const installation = await githubRepository.findInstallationOwned(
      input.userId,
      repository.sourceConnectionId,
    );
    if (!installation) throw new GitHubSyncError('INSTALLATION_REVOKED', 401);
    const token = installationToken(
      await deps.client.createInstallationToken(installation.installationId),
    );
    const liveRepository = await deps.client.getRepository(token, repository.externalRepositoryId);
    if (liveRepository.id !== repository.externalRepositoryId || liveRepository.archived || liveRepository.disabled) {
      throw new GitHubSyncError('REPOSITORY_INACCESSIBLE', 422);
    }
    const commit = await deps.client.getCommit(token, liveRepository.fullName, liveRepository.defaultBranch);
    if (!isCommitSha(commit.sha)) throw new GitHubSyncError('SYNC_FAILED', 502);
    const enqueued = await enqueueKnownGitHubCommit({
      userId: input.userId,
      sourceConnectionId: repository.sourceConnectionId,
      sourceRepositoryId: repository.id,
      commitSha: commit.sha,
      trigger: input.trigger,
      requestId: input.requestId,
    });
    await authRepository.writeAudit({
      actorUserId: input.userId,
      action: 'github.sync_enqueued',
      targetType: 'source_repository',
      targetId: repository.id,
      outcome: 'success',
      requestId: input.requestId,
      metadata: { commitSha: commit.sha, trigger: input.trigger, created: enqueued.created },
    });
    return enqueued;
  } catch (error) {
    throw mapSyncError(error);
  }
}

export const githubSyncService = {
  async enqueueRepository(
    actor: ActorContext,
    sourceRepositoryId: string,
    trigger: 'initial' | 'manual' | 'scheduled' = 'manual',
    overrides: GitHubSyncDependencies = {},
  ) {
    await dbReady;
    return enqueueRepositoryOwned({
      userId: actor.userId,
      requestId: actor.requestId,
      sourceRepositoryId,
      trigger,
    }, overrides);
  },

  async runScheduledCycle(
    input: { staleBefore?: Date; repositoryLimit?: number; jobLimit?: number } = {},
    overrides: GitHubSyncDependencies = {},
  ) {
    await dbReady;
    const now = new Date();
    const staleBefore = input.staleBefore || new Date(now.getTime() - 15 * 60 * 1000);
    const repositoryLimit = Math.min(Math.max(input.repositoryLimit || 100, 1), 500);
    const jobLimit = Math.min(Math.max(input.jobLimit || 100, 1), 500);
    const repositories = await githubRepository.listDueRepositoriesForScheduledSync(
      staleBefore,
      repositoryLimit,
    );
    let jobsCreated = 0;
    let jobsRequeued = 0;
    const errors: Array<{ repositoryId: string; errorCode: string }> = [];
    for (const repository of repositories) {
      try {
        const enqueued = await enqueueRepositoryOwned({
          userId: repository.userId,
          requestId: `github-scheduled:${now.toISOString()}`,
          sourceRepositoryId: repository.id,
          trigger: 'scheduled',
        }, overrides);
        if (enqueued.created) jobsCreated++;
        if (enqueued.requeued) jobsRequeued++;
      } catch (error) {
        const mapped = mapSyncError(error);
        errors.push({ repositoryId: repository.id, errorCode: mapped.code });
      }
    }
    const runnableJobIds = await githubRepository.listRunnableSyncJobIds(now, jobLimit);
    const jobResults = [];
    for (const jobId of runnableJobIds) {
      jobResults.push({ jobId, result: await this.runJob(jobId, overrides) });
    }
    return {
      repositoriesChecked: repositories.length,
      jobsCreated,
      jobsRequeued,
      jobsRun: jobResults.length,
      jobsSucceeded: jobResults.filter((job) => job.result.status === 'succeeded').length,
      jobsFailed: jobResults.filter((job) => job.result.status === 'failed').length,
      jobsSkipped: jobResults.filter((job) => job.result.status === 'skipped').length,
      errors,
    };
  },

  async runJob(jobId: string, overrides: GitHubSyncDependencies = {}) {
    await dbReady;
    let claimed: Awaited<ReturnType<typeof githubRepository.claimSyncJob>> = null;
    try {
      claimed = await githubRepository.claimSyncJob(jobId);
      if (!claimed) return { status: 'skipped' as const };
      const deps = dependencies(overrides);
      const context = await githubRepository.loadSyncContext(jobId);
      const requestedCommitSha = context.job.requestedCommitSha;
      if (!requestedCommitSha || !isCommitSha(requestedCommitSha)) {
        throw new GitHubSyncError('SYNC_FAILED', 400);
      }

      // This token is deliberately kept in this stack frame only. Persistence APIs receive
      // installation/repository identifiers and parsed artifacts, never the credential.
      const token = installationToken(
        await deps.client.createInstallationToken(context.installation.installationId),
      );
      const liveRepository = await deps.client.getRepository(token, context.repository.externalRepositoryId);
      if (liveRepository.id !== context.repository.externalRepositoryId
        || liveRepository.archived
        || liveRepository.disabled) {
        throw new GitHubSyncError('REPOSITORY_INACCESSIBLE', 422);
      }
      const commit = await deps.client.getCommit(token, liveRepository.fullName, requestedCommitSha);
      if (commit.sha.toLowerCase() !== requestedCommitSha.toLowerCase() || !isCommitSha(commit.treeSha)) {
        throw new GitHubSyncError('SYNC_FAILED', 502);
      }
      const tree = await deps.client.getTree(token, liveRepository.fullName, commit.treeSha);
      if (tree.sha.toLowerCase() !== commit.treeSha.toLowerCase()) {
        throw new GitHubSyncError('SYNC_FAILED', 502);
      }
      const filtered = filterGitHubTree(tree.entries);
      const expectedBytes = filtered.accepted.reduce((sum, entry) => sum + (entry.size || 0), 0);
      if (filtered.accepted.length > MAX_FETCHED_DOCUMENTS || expectedBytes > MAX_FETCHED_BYTES) {
        throw new GitHubSyncError('REPOSITORY_TOO_LARGE', 422);
      }
      const latest = await githubRepository.latestSnapshotDocuments({
        userId: context.job.userId,
        sourceRepositoryId: context.repository.id,
        parserId: WORKRESUME_PARSER_ID,
        parserVersion: WORKRESUME_PARSER_VERSION,
      });
      const priorByBlob = new Map<string, NonNullable<typeof latest>['documents'][number]>();
      for (const document of latest?.documents || []) {
        if (document.blobSha && !priorByBlob.has(document.blobSha)) {
          priorByBlob.set(document.blobSha, document);
        }
      }
      const documents: SourceDocumentImportInput[] = [];
      let fetchedBlobs = 0;
      let reusedBlobs = 0;
      for (const entry of filtered.accepted) {
        const previous = priorByBlob.get(entry.sha);
        if (previous) {
          documents.push(reusableDocument(entry.path, entry.sha, previous));
          reusedBlobs++;
          continue;
        }
        const blob = await deps.client.getBlob(token, liveRepository.fullName, entry.sha);
        if (blob.sha.toLowerCase() !== entry.sha.toLowerCase() || blob.size !== entry.size) {
          throw new GitHubSyncError('SYNC_FAILED', 502);
        }
        documents.push(inspectGitHubDocument({
          path: entry.path,
          blobSha: entry.sha,
          bytes: decodeAndVerifyGitHubBlob(blob),
        }));
        fetchedBlobs++;
      }
      documents.push(...filtered.ignored.slice(0, MAX_RECORDED_IGNORED_DOCUMENTS));
      documents.sort((a, b) => a.path.localeCompare(b.path));
      const parsed = parseWorkResumeV2Documents(documents);
      const imported = await careerRepository.importSnapshotOwned({
        userId: context.job.userId,
        repository: {
          sourceType: 'github',
          sourceConnectionId: context.job.sourceConnectionId,
          externalRepositoryId: liveRepository.id,
          fullName: liveRepository.fullName,
          defaultBranch: liveRepository.defaultBranch,
        },
        commitSha: commit.sha.toLowerCase(),
        treeSha: tree.sha.toLowerCase(),
        parentSnapshotId: latest?.snapshot.id || null,
        parserId: parsed.parserId,
        parserVersion: parsed.parserVersion,
        documents,
        facts: parsed.facts,
      });
      const currentBlobShas = new Set(filtered.accepted.map((entry) => entry.sha));
      const evidenceMarkedStale = await careerRepository.markEvidenceStaleForMissingBlobsOwned(
        context.job.userId,
        imported.repositoryId,
        currentBlobShas,
      );
      await githubRepository.completeSyncJob(jobId);
      return {
        status: 'succeeded' as const,
        ...imported,
        fetchedBlobs,
        reusedBlobs,
        ignoredDocuments: filtered.ignored.length,
        evidenceMarkedStale,
      };
    } catch (error) {
      const mapped = mapSyncError(error);
      const retryAt = retryAtForFailure(mapped, claimed?.attemptCount || 0);
      if (claimed) {
        await githubRepository.failSyncJob(jobId, {
          errorCode: mapped.code,
          errorMessage: mapped.code,
          retryAt,
          connectionStatus: failureConnectionStatus(mapped),
        });
      }
      return { status: 'failed' as const, errorCode: mapped.code, retryAt };
    }
  },
};
