import { NextRequest } from 'next/server';
import { z } from 'zod/v4';

import { authFailureResponse, readAuthJson, resolveActor } from '@/lib/auth/api';
import { getRequestMetadata, hasTrustedOrigin } from '@/lib/auth/http';
import { githubErrorResponse, noStoreJson } from '@/lib/github/api';
import { githubConnectionService } from '@/lib/github/service';

const connectSchema = z.object({
  returnPath: z.string().trim().max(512).optional(),
}).strict();

export async function POST(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  if (!hasTrustedOrigin(request)) return authFailureResponse('UNTRUSTED_ORIGIN', metadata.requestId);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const input = await readAuthJson(request, connectSchema);
    const result = await githubConnectionService.startConnection(actor, input);
    return noStoreJson({
      connectionId: result.connectionId,
      installationUrl: result.installationUrl,
      expiresAt: result.expiresAt.toISOString(),
    }, metadata.requestId, 201);
  } catch (error) {
    return githubErrorResponse(error, metadata.requestId);
  }
}
