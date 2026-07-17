import { NextRequest } from 'next/server';
import { z } from 'zod/v4';

import { authFailureResponse, readAuthJson, resolveActor } from '@/lib/auth/api';
import { getRequestMetadata, hasTrustedOrigin } from '@/lib/auth/http';
import { dateString, githubErrorResponse, noStoreJson } from '@/lib/github/api';
import { GitHubPatServiceError, githubPatService } from '@/lib/github/pat-service';

const selectionSchema = z.object({
  repositoryIds: z.array(z.string().regex(/^\d{1,30}$/)).max(100),
}).strict();

function connectionIdFrom(value: string) {
  if (!z.string().uuid().safeParse(value).success) {
    throw new GitHubPatServiceError('CONNECTION_NOT_FOUND', 400);
  }
  return value;
}

function liveRepositoryResponse(repository: Awaited<ReturnType<typeof githubPatService.listRepositories>>[number]) {
  return {
    id: repository.id,
    name: repository.name,
    fullName: repository.fullName,
    private: repository.private,
    defaultBranch: repository.defaultBranch,
    archived: repository.archived,
    disabled: repository.disabled,
    selected: repository.selected,
  };
}

function storedRepositoryResponse(
  repository: Awaited<ReturnType<typeof githubPatService.selectRepositories>>[number],
) {
  return {
    id: repository.id,
    externalRepositoryId: repository.externalRepositoryId,
    fullName: repository.fullName,
    defaultBranch: repository.defaultBranch,
    selected: repository.selected,
    lastHeadSha: repository.lastHeadSha,
    lastSyncedAt: dateString(repository.lastSyncedAt),
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const metadata = getRequestMetadata(request);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const connectionId = connectionIdFrom((await params).connectionId);
    const repositories = await githubPatService.listRepositories(actor, connectionId);
    return noStoreJson(repositories.map(liveRepositoryResponse), metadata.requestId);
  } catch (error) {
    return githubErrorResponse(error, metadata.requestId);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const metadata = getRequestMetadata(request);
  if (!hasTrustedOrigin(request)) {
    return authFailureResponse('UNTRUSTED_ORIGIN', metadata.requestId);
  }
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const connectionId = connectionIdFrom((await params).connectionId);
    const input = await readAuthJson(request, selectionSchema);
    const repositories = await githubPatService.selectRepositories(
      actor,
      connectionId,
      input.repositoryIds,
    );
    return noStoreJson(repositories.map(storedRepositoryResponse), metadata.requestId);
  } catch (error) {
    return githubErrorResponse(error, metadata.requestId);
  }
}
