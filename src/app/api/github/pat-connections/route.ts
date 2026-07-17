import { NextRequest } from 'next/server';
import { z } from 'zod/v4';

import { authFailureResponse, readAuthJson, resolveActor } from '@/lib/auth/api';
import { getRequestMetadata, hasTrustedOrigin } from '@/lib/auth/http';
import { dateString, githubErrorResponse, noStoreJson } from '@/lib/github/api';
import { githubPatService } from '@/lib/github/pat-service';

const connectionSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  token: z.string().min(1).max(255),
}).strict();

function connectionResponse(connection: Awaited<ReturnType<typeof githubPatService.listConnections>>[number]) {
  return {
    id: connection.id,
    status: connection.status,
    lastSyncedAt: dateString(connection.lastSyncedAt),
    lastErrorCode: connection.lastErrorCode,
    createdAt: dateString(connection.createdAt),
    updatedAt: dateString(connection.updatedAt),
    credential: connection.credential ? {
      label: connection.credential.label,
      accountLogin: connection.credential.accountLogin,
    } : null,
    repositories: connection.repositories.map((repository) => ({
      id: repository.id,
      externalRepositoryId: repository.externalRepositoryId,
      fullName: repository.fullName,
      defaultBranch: repository.defaultBranch,
      selected: repository.selected,
      lastHeadSha: repository.lastHeadSha,
      lastSyncedAt: dateString(repository.lastSyncedAt),
    })),
    recentJobs: connection.recentJobs.map((job) => ({
      id: job.id,
      sourceRepositoryId: job.sourceRepositoryId,
      trigger: job.trigger,
      status: job.status,
      requestedCommitSha: job.requestedCommitSha,
      attemptCount: job.attemptCount,
      errorCode: job.errorCode,
      nextAttemptAt: dateString(job.nextAttemptAt),
      createdAt: dateString(job.createdAt),
      completedAt: dateString(job.completedAt),
    })),
  };
}

export async function GET(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const connections = await githubPatService.listConnections(actor);
    return noStoreJson(connections.map(connectionResponse), metadata.requestId);
  } catch (error) {
    return githubErrorResponse(error, metadata.requestId);
  }
}

export async function POST(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  if (!hasTrustedOrigin(request)) {
    return authFailureResponse('UNTRUSTED_ORIGIN', metadata.requestId);
  }
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const input = await readAuthJson(request, connectionSchema);
    const created = await githubPatService.createConnection(actor, input);
    return noStoreJson({
      id: created.id,
      status: created.status,
      createdAt: dateString(created.createdAt),
    }, metadata.requestId, 201);
  } catch (error) {
    return githubErrorResponse(error, metadata.requestId);
  }
}
