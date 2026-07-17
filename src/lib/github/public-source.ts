import type { ActorContext } from '@/lib/auth/service';
import { hashOpaqueToken } from '@/lib/auth/tokens';
import {
  parseWorkResumeV2Documents,
  WORKRESUME_PARSER_ID,
  WORKRESUME_PARSER_VERSION,
  WorkResumeImportError,
} from '@/lib/career/workresume-v2';
import type { SourceDocumentImportInput } from '@/lib/career/types';
import { dbReady } from '@/lib/db';
import { authRepository } from '@/lib/db/repositories/auth.repository';
import {
  careerRepository,
  CareerRepositoryError,
} from '@/lib/db/repositories/career.repository';
import { githubRepository } from '@/lib/db/repositories/github.repository';

import {
  decodeAndVerifyGitHubBlob,
  GitHubApiError,
  GitHubPublicClient,
} from './client';
import { filterGitHubTree, githubDocumentMimeType, inspectGitHubDocument } from './security';
import {
  normalizePublicGitHubRepositoryUrl,
  PublicGitHubUrlError,
} from './public-url';
import type { GitHubBlob, GitHubCommit, GitHubRepository, GitHubTree } from './types';

const SOURCE_TYPE = 'github-public' as const;
const MAX_FETCHED_DOCUMENTS = 500;
const MAX_FETCHED_BYTES = 12 * 1024 * 1024;
const MAX_RECORDED_IGNORED_DOCUMENTS = 1_000;

export interface PublicGitHubSourceApi {
  getRepository(fullName: string): Promise<GitHubRepository>;
  getCommit(fullName: string, ref: string): Promise<GitHubCommit>;
  getTree(fullName: string, treeSha: string): Promise<GitHubTree>;
  getBlob(fullName: string, blobSha: string): Promise<GitHubBlob>;
}

export class PublicGitHubSourceError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_REPOSITORY_URL'
      | 'REPOSITORY_NOT_FOUND'
      | 'REPOSITORY_NOT_PUBLIC'
      | 'REPOSITORY_INACCESSIBLE'
      | 'GITHUB_RATE_LIMITED'
      | 'REPOSITORY_TOO_LARGE'
      | 'UNSUPPORTED_LAYOUT'
      | 'SECRET_DETECTED'
      | 'PARSER_VALIDATION_FAILED'
      | 'SYNC_FAILED'
      | 'TOO_MANY_ATTEMPTS',
    public readonly status: number,
    public readonly retryAt: Date | null = null,
  ) {
    super(code);
    this.name = 'PublicGitHubSourceError';
  }
}

function isCommitSha(value: string): boolean {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value);
}

function asIso(value: Date | number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date
    ? value
    : new Date(typeof value === 'number' && value < 10_000_000_000 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sourceDto(repository: {
  id: string;
  fullName: string;
  defaultBranch: string;
  lastHeadSha: string | null;
  lastSyncedAt: Date | number | string | null;
}) {
  return {
    id: repository.id,
    kind: SOURCE_TYPE,
    fullName: repository.fullName,
    repositoryUrl: `https://github.com/${repository.fullName}`,
    defaultBranch: repository.defaultBranch,
    lastRevision: repository.lastHeadSha,
    lastImportedAt: asIso(repository.lastSyncedAt),
  };
}

function mapError(error: unknown): PublicGitHubSourceError {
  if (error instanceof PublicGitHubSourceError) return error;
  if (error instanceof PublicGitHubUrlError) {
    return new PublicGitHubSourceError('INVALID_REPOSITORY_URL', 400);
  }
  if (error instanceof GitHubApiError) {
    if (error.code === 'RATE_LIMITED') {
      return new PublicGitHubSourceError('GITHUB_RATE_LIMITED', 429, error.retryAt);
    }
    if (error.code === 'REPOSITORY_NOT_FOUND' || error.code === 'AUTH_FAILED') {
      return new PublicGitHubSourceError('REPOSITORY_NOT_FOUND', 404);
    }
    if (error.code === 'PERMISSION_DENIED') {
      return new PublicGitHubSourceError('REPOSITORY_INACCESSIBLE', 403);
    }
    if (error.code === 'RESPONSE_TOO_LARGE' || error.code === 'TREE_TRUNCATED') {
      return new PublicGitHubSourceError('REPOSITORY_TOO_LARGE', 422);
    }
    return new PublicGitHubSourceError('SYNC_FAILED', 502);
  }
  if (error instanceof WorkResumeImportError) {
    if (error.code === 'SECRET_FILE_BLOCKED') {
      return new PublicGitHubSourceError('SECRET_DETECTED', 422);
    }
    if (['CONFIG_NOT_FOUND', 'INVALID_CONFIG', 'INVALID_CAPABILITY_POOL'].includes(error.code)) {
      return new PublicGitHubSourceError('UNSUPPORTED_LAYOUT', 422);
    }
    if (['FILE_TOO_LARGE', 'IMPORT_TOO_LARGE', 'TOO_MANY_DOCUMENTS'].includes(error.code)) {
      return new PublicGitHubSourceError('REPOSITORY_TOO_LARGE', 422);
    }
    return new PublicGitHubSourceError('PARSER_VALIDATION_FAILED', 422);
  }
  if (error instanceof CareerRepositoryError) {
    return new PublicGitHubSourceError('SYNC_FAILED', 409);
  }
  return new PublicGitHubSourceError('SYNC_FAILED', 500);
}

function reusableDocument(
  filePath: string,
  blobSha: string,
  previous: {
    contentHash: string;
    sizeBytes: number;
    textContent: string | null;
    parseStatus: 'ready' | 'ignored' | 'failed';
    securityFindings: Array<{ code: string; severity: 'info' | 'warning' | 'blocked' }>;
    llmEligible: boolean;
  },
): SourceDocumentImportInput {
  return {
    path: filePath,
    blobSha,
    contentHash: previous.contentHash,
    mimeType: githubDocumentMimeType(filePath),
    sizeBytes: previous.sizeBytes,
    textContent: previous.textContent,
    parseStatus: previous.parseStatus,
    securityFindings: previous.securityFindings,
    llmEligible: previous.llmEligible,
  };
}

async function writeAudit(
  actor: ActorContext,
  outcome: 'success' | 'failure',
  targetId: string | null,
  metadata: Record<string, unknown>,
) {
  await authRepository.writeAudit({
    actorUserId: actor.userId,
    action: 'knowledge.github_public_imported',
    targetType: 'source_repository',
    targetId,
    outcome,
    requestId: actor.requestId,
    metadata,
  });
}

export const publicGitHubSourceService = {
  async list(actor: ActorContext) {
    await dbReady;
    return (await careerRepository.listSourceRepositoriesOwned(actor.userId, SOURCE_TYPE))
      .map(sourceDto);
  },

  async importRepository(
    actor: ActorContext,
    repositoryUrl: string,
    overrides: { client?: PublicGitHubSourceApi } = {},
  ) {
    await dbReady;
    let reference;
    try {
      reference = normalizePublicGitHubRepositoryUrl(repositoryUrl);
    } catch (error) {
      throw mapError(error);
    }
    const rateLimit = await authRepository.consumeRateLimit({
      keyHash: hashOpaqueToken(`knowledge.github-public\0${actor.userId}`),
      scope: 'knowledge.github-public',
      maxAttempts: 20,
      windowMs: 15 * 60 * 1000,
      blockMs: 15 * 60 * 1000,
    });
    if (!rateLimit.allowed) {
      throw new PublicGitHubSourceError(
        'TOO_MANY_ATTEMPTS',
        429,
        new Date(Date.now() + rateLimit.retryAfterSeconds * 1000),
      );
    }

    const client = overrides.client || new GitHubPublicClient();
    let repositoryId: string | null = null;
    try {
      const liveRepository = await client.getRepository(reference.fullName);
      if (liveRepository.fullName.toLowerCase() !== reference.fullName.toLowerCase()) {
        throw new PublicGitHubSourceError('REPOSITORY_NOT_FOUND', 404);
      }
      if (liveRepository.private) throw new PublicGitHubSourceError('REPOSITORY_NOT_PUBLIC', 422);
      if (liveRepository.archived || liveRepository.disabled) {
        throw new PublicGitHubSourceError('REPOSITORY_INACCESSIBLE', 422);
      }
      const commit = await client.getCommit(liveRepository.fullName, liveRepository.defaultBranch);
      if (!isCommitSha(commit.sha) || !isCommitSha(commit.treeSha)) {
        throw new PublicGitHubSourceError('SYNC_FAILED', 502);
      }
      const existing = await careerRepository.findSourceRepositoryOwned(
        actor.userId,
        SOURCE_TYPE,
        liveRepository.id,
      );
      repositoryId = existing?.id || null;
      if (existing?.lastHeadSha?.toLowerCase() === commit.sha.toLowerCase()) {
        await writeAudit(actor, 'success', existing.id, {
          repositoryId: liveRepository.id,
          revision: commit.sha.toLowerCase(),
          alreadyImported: true,
        });
        return {
          source: sourceDto(existing),
          alreadyImported: true,
          fetchedBlobs: 0,
          reusedBlobs: 0,
          ignoredDocuments: 0,
          documentsCreated: 0,
          factsCreated: 0,
          factsReused: 0,
          evidenceCreated: 0,
          claimsCreated: 0,
          evidenceMarkedStale: 0,
        };
      }

      const tree = await client.getTree(liveRepository.fullName, commit.treeSha);
      if (tree.sha.toLowerCase() !== commit.treeSha.toLowerCase()) {
        throw new PublicGitHubSourceError('SYNC_FAILED', 502);
      }
      const filtered = filterGitHubTree(tree.entries);
      const expectedBytes = filtered.accepted.reduce((sum, entry) => sum + (entry.size || 0), 0);
      if (filtered.accepted.length > MAX_FETCHED_DOCUMENTS || expectedBytes > MAX_FETCHED_BYTES) {
        throw new PublicGitHubSourceError('REPOSITORY_TOO_LARGE', 422);
      }
      const latest = existing ? await githubRepository.latestSnapshotDocuments({
        userId: actor.userId,
        sourceRepositoryId: existing.id,
        parserId: WORKRESUME_PARSER_ID,
        parserVersion: WORKRESUME_PARSER_VERSION,
      }) : null;
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
        const blob = await client.getBlob(liveRepository.fullName, entry.sha);
        if (blob.sha.toLowerCase() !== entry.sha.toLowerCase() || blob.size !== entry.size) {
          throw new PublicGitHubSourceError('SYNC_FAILED', 502);
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
        userId: actor.userId,
        repository: {
          sourceType: SOURCE_TYPE,
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
      repositoryId = imported.repositoryId;
      const currentBlobShas = new Set(filtered.accepted.map((entry) => entry.sha));
      const evidenceMarkedStale = imported.alreadyImported ? 0
        : await careerRepository.markEvidenceStaleForMissingBlobsOwned(
          actor.userId,
          imported.repositoryId,
          currentBlobShas,
        );
      const storedRepository = await careerRepository.findSourceRepositoryOwned(
        actor.userId,
        SOURCE_TYPE,
        liveRepository.id,
      );
      if (!storedRepository) throw new CareerRepositoryError('IMPORT_CONFLICT');
      await writeAudit(actor, 'success', imported.repositoryId, {
        repositoryId: liveRepository.id,
        revision: commit.sha.toLowerCase(),
        alreadyImported: imported.alreadyImported,
        fetchedBlobs,
        reusedBlobs,
        ignoredDocuments: filtered.ignored.length,
        documentsCreated: imported.documentsCreated,
        factsCreated: imported.factsCreated,
        factsReused: imported.factsReused,
        evidenceMarkedStale,
      });
      return {
        source: sourceDto(storedRepository),
        alreadyImported: imported.alreadyImported,
        fetchedBlobs,
        reusedBlobs,
        ignoredDocuments: filtered.ignored.length,
        documentsCreated: imported.documentsCreated,
        factsCreated: imported.factsCreated,
        factsReused: imported.factsReused,
        evidenceCreated: imported.evidenceCreated,
        claimsCreated: imported.claimsCreated,
        evidenceMarkedStale,
      };
    } catch (error) {
      const mapped = mapError(error);
      await writeAudit(actor, 'failure', repositoryId, { errorCode: mapped.code });
      throw mapped;
    }
  },
};
