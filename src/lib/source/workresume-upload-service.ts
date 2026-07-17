import type { ActorContext } from '@/lib/auth/service';
import { hashOpaqueToken } from '@/lib/auth/tokens';
import { dbReady } from '@/lib/db';
import { authRepository } from '@/lib/db/repositories/auth.repository';
import {
  careerRepository,
  CareerRepositoryError,
} from '@/lib/db/repositories/career.repository';

import {
  prepareWorkResumeUpload,
  toUploadedCareerSnapshotImport,
  WORKRESUME_UPLOAD_EXTERNAL_ID,
  WORKRESUME_UPLOAD_SOURCE_TYPE,
  type WorkResumeUploadEntry,
  WorkResumeUploadError,
  type WorkResumeUploadErrorCode,
} from './workresume-upload';

export type WorkResumeUploadServiceErrorCode = WorkResumeUploadErrorCode
  | 'IMPORT_CONFLICT'
  | 'TOO_MANY_ATTEMPTS';

export class WorkResumeUploadServiceError extends Error {
  constructor(
    public readonly code: WorkResumeUploadServiceErrorCode,
    public readonly status: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = 'WorkResumeUploadServiceError';
  }
}

function normalizeSourceName(value: string | undefined): string {
  const normalized = value?.normalize('NFKC').trim().replace(/\s+/g, ' ') || 'Uploaded WorkResume';
  return Array.from(normalized).slice(0, 120).join('');
}

function asIso(value: Date | number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date
    ? value
    : new Date(typeof value === 'number' && value < 10_000_000_000 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function statusFor(error: WorkResumeUploadError): number {
  switch (error.code) {
    case 'PAYLOAD_TOO_LARGE':
    case 'TOO_MANY_FILES':
      return 413;
    case 'SECRET_DETECTED':
    case 'UNSUPPORTED_LAYOUT':
    case 'PARSER_VALIDATION_FAILED':
      return 422;
    default:
      return 400;
  }
}

function sourceDto(
  repository: {
    id: string;
    fullName: string;
    lastHeadSha: string | null;
    lastSyncedAt: Date | number | string | null;
  },
  snapshot?: { id: string; commitSha: string; createdAt: Date | number | string } | null,
) {
  return {
    id: repository.id,
    kind: WORKRESUME_UPLOAD_SOURCE_TYPE,
    name: repository.fullName,
    lastRevision: snapshot?.commitSha || repository.lastHeadSha,
    lastImportedAt: asIso(snapshot?.createdAt || repository.lastSyncedAt),
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
    action: 'knowledge.workresume_uploaded',
    targetType: 'source_repository',
    targetId,
    outcome,
    requestId: actor.requestId,
    metadata,
  });
}

export const workResumeUploadService = {
  async getStatus(actor: ActorContext) {
    await dbReady;
    const repository = await careerRepository.findSourceRepositoryOwned(
      actor.userId,
      WORKRESUME_UPLOAD_SOURCE_TYPE,
      WORKRESUME_UPLOAD_EXTERNAL_ID,
    );
    if (!repository) return { source: null };
    const snapshot = await careerRepository.findLatestReadySnapshotOwned(actor.userId, repository.id);
    return { source: sourceDto(repository, snapshot) };
  },

  async importDirectory(
    actor: ActorContext,
    input: { sourceName?: string; entries: readonly WorkResumeUploadEntry[] },
  ) {
    await dbReady;
    const rateLimit = await authRepository.consumeRateLimit({
      keyHash: hashOpaqueToken(`knowledge.workresume-upload\0${actor.userId}`),
      scope: 'knowledge.workresume-upload',
      maxAttempts: 20,
      windowMs: 15 * 60 * 1000,
      blockMs: 15 * 60 * 1000,
    });
    if (!rateLimit.allowed) {
      throw new WorkResumeUploadServiceError(
        'TOO_MANY_ATTEMPTS',
        429,
        rateLimit.retryAfterSeconds,
      );
    }

    let prepared;
    try {
      prepared = prepareWorkResumeUpload(input.entries);
    } catch (error) {
      if (error instanceof WorkResumeUploadError) {
        await writeAudit(actor, 'failure', null, { errorCode: error.code, fileCount: input.entries.length });
        throw new WorkResumeUploadServiceError(error.code, statusFor(error));
      }
      throw error;
    }

    const existingRepository = await careerRepository.findSourceRepositoryOwned(
      actor.userId,
      WORKRESUME_UPLOAD_SOURCE_TYPE,
      WORKRESUME_UPLOAD_EXTERNAL_ID,
    );
    const parent = existingRepository
      ? await careerRepository.findLatestReadySnapshotOwned(actor.userId, existingRepository.id)
      : null;

    try {
      const imported = await careerRepository.importSnapshotOwned(toUploadedCareerSnapshotImport({
        userId: actor.userId,
        sourceName: normalizeSourceName(input.sourceName),
        prepared,
        parentSnapshotId: parent?.id || null,
      }));
      const currentBlobShas = new Set(
        prepared.parsed.documents.flatMap((document) => document.blobSha ? [document.blobSha] : []),
      );
      const evidenceMarkedStale = imported.alreadyImported
        ? 0
        : await careerRepository.markEvidenceStaleForMissingBlobsOwned(
          actor.userId,
          imported.repositoryId,
          currentBlobShas,
        );
      const repository = await careerRepository.findSourceRepositoryOwned(
        actor.userId,
        WORKRESUME_UPLOAD_SOURCE_TYPE,
        WORKRESUME_UPLOAD_EXTERNAL_ID,
      );
      if (!repository) throw new CareerRepositoryError('IMPORT_CONFLICT');
      const snapshot = await careerRepository.findLatestReadySnapshotOwned(actor.userId, repository.id);
      await writeAudit(actor, 'success', imported.repositoryId, {
        revision: prepared.revision,
        alreadyImported: imported.alreadyImported,
        uploadedFiles: prepared.uploadedFiles,
        ignoredFiles: prepared.ignoredFiles,
        documentsCreated: imported.documentsCreated,
        factsCreated: imported.factsCreated,
        factsReused: imported.factsReused,
        evidenceMarkedStale,
      });
      return {
        source: sourceDto(repository, snapshot),
        snapshotId: imported.snapshotId,
        alreadyImported: imported.alreadyImported,
        uploadedFiles: prepared.uploadedFiles,
        ignoredFiles: prepared.ignoredFiles,
        documentsCreated: imported.documentsCreated,
        factsCreated: imported.factsCreated,
        factsReused: imported.factsReused,
        evidenceCreated: imported.evidenceCreated,
        claimsCreated: imported.claimsCreated,
        evidenceMarkedStale,
      };
    } catch (error) {
      if (error instanceof CareerRepositoryError) {
        await writeAudit(actor, 'failure', existingRepository?.id || null, { errorCode: error.code });
        throw new WorkResumeUploadServiceError('IMPORT_CONFLICT', 409);
      }
      throw error;
    }
  },
};
