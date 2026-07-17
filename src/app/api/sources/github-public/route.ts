import { NextRequest } from 'next/server';
import { z } from 'zod/v4';

import {
  authFailureResponse,
  readAuthJson,
  resolveActor,
} from '@/lib/auth/api';
import { getRequestMetadata, hasTrustedOrigin } from '@/lib/auth/http';
import { githubErrorResponse, noStoreJson } from '@/lib/github/api';
import { publicGitHubSourceService } from '@/lib/github/public-source';

const importSchema = z.object({
  repositoryUrl: z.string().min(1).max(300),
}).strict();

export async function GET(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    return noStoreJson(await publicGitHubSourceService.list(actor), metadata.requestId);
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
    const input = await readAuthJson(request, importSchema);
    const result = await publicGitHubSourceService.importRepository(actor, input.repositoryUrl);
    return noStoreJson(result, metadata.requestId, result.alreadyImported ? 200 : 201);
  } catch (error) {
    return githubErrorResponse(error, metadata.requestId);
  }
}
