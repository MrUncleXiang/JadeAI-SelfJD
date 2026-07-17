import { NextRequest } from 'next/server';

import { authFailureResponse, resolveActor } from '@/lib/auth/api';
import { getRequestMetadata } from '@/lib/auth/http';
import { dateString, githubErrorResponse, noStoreJson } from '@/lib/github/api';
import { githubConnectionService } from '@/lib/github/service';

export async function GET(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const connections = await githubConnectionService.listConnections(actor);
    return noStoreJson(connections.map((connection) => ({
      id: connection.id,
      status: connection.status,
      lastSyncedAt: dateString(connection.lastSyncedAt),
      lastErrorCode: connection.lastErrorCode,
      createdAt: dateString(connection.createdAt),
      updatedAt: dateString(connection.updatedAt),
      installation: connection.installation ? {
        accountLogin: connection.installation.accountLogin,
        accountType: connection.installation.accountType,
        repositorySelection: connection.installation.repositorySelection,
        suspendedAt: dateString(connection.installation.suspendedAt),
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
        createdAt: dateString(job.createdAt),
        completedAt: dateString(job.completedAt),
      })),
    })), metadata.requestId);
  } catch (error) {
    return githubErrorResponse(error, metadata.requestId);
  }
}
