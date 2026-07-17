import { NextRequest } from 'next/server';
import { z } from 'zod/v4';

import { authFailureResponse, readAuthJson, resolveActor } from '@/lib/auth/api';
import { getRequestMetadata, hasTrustedOrigin } from '@/lib/auth/http';
import { githubErrorResponse, noStoreJson } from '@/lib/github/api';
import { GitHubServiceError, githubConnectionService } from '@/lib/github/service';

const selectionSchema = z.object({
  connectionId: z.string().uuid(),
  repositoryIds: z.array(z.string().regex(/^\d{1,30}$/)).max(100),
}).strict();

function availableRepositoryResponse(repository: {
  id: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  archived: boolean;
  disabled: boolean;
  selected: boolean;
}) {
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

function selectedRepositoryResponse(repository: {
  id: string;
  externalRepositoryId: string;
  fullName: string;
  defaultBranch: string;
  selected: boolean;
  lastHeadSha: string | null;
  lastSyncedAt: Date | null;
}) {
  return {
    id: repository.id,
    externalRepositoryId: repository.externalRepositoryId,
    fullName: repository.fullName,
    defaultBranch: repository.defaultBranch,
    selected: repository.selected,
    lastHeadSha: repository.lastHeadSha,
    lastSyncedAt: repository.lastSyncedAt?.toISOString() || null,
  };
}

export async function GET(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const connectionId = request.nextUrl.searchParams.get('connectionId');
    if (!connectionId || !z.string().uuid().safeParse(connectionId).success) {
      throw new GitHubServiceError('CONNECTION_NOT_FOUND', 400);
    }
    const repositories = await githubConnectionService.listRepositories(actor, connectionId);
    return noStoreJson(repositories.map(availableRepositoryResponse), metadata.requestId);
  } catch (error) {
    return githubErrorResponse(error, metadata.requestId);
  }
}

export async function PUT(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  if (!hasTrustedOrigin(request)) return authFailureResponse('UNTRUSTED_ORIGIN', metadata.requestId);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const input = await readAuthJson(request, selectionSchema);
    const repositories = await githubConnectionService.selectRepositories(
      actor,
      input.connectionId,
      input.repositoryIds,
    );
    return noStoreJson(repositories.map(selectedRepositoryResponse), metadata.requestId);
  } catch (error) {
    return githubErrorResponse(error, metadata.requestId);
  }
}
