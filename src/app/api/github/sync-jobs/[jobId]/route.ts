import { NextRequest } from 'next/server';

import { authFailureResponse, resolveActor } from '@/lib/auth/api';
import { getRequestMetadata } from '@/lib/auth/http';
import { githubRepository } from '@/lib/db/repositories/github.repository';
import { dateString, githubErrorResponse, noStoreJson } from '@/lib/github/api';
import { GitHubSyncError } from '@/lib/github/sync';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const metadata = getRequestMetadata(request);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const { jobId } = await params;
    const job = await githubRepository.findSyncJobOwned(actor.userId, jobId);
    if (!job) throw new GitHubSyncError('REPOSITORY_NOT_FOUND', 404);
    return noStoreJson({
      id: job.id,
      sourceRepositoryId: job.sourceRepositoryId,
      trigger: job.trigger,
      status: job.status,
      requestedCommitSha: job.requestedCommitSha,
      attemptCount: job.attemptCount,
      errorCode: job.errorCode,
      nextAttemptAt: dateString(job.nextAttemptAt),
      startedAt: dateString(job.startedAt),
      completedAt: dateString(job.completedAt),
      createdAt: dateString(job.createdAt),
      updatedAt: dateString(job.updatedAt),
    }, metadata.requestId);
  } catch (error) {
    return githubErrorResponse(error, metadata.requestId);
  }
}
