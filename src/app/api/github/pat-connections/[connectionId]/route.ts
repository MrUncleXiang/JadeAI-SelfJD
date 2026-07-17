import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';

import { authFailureResponse, resolveActor } from '@/lib/auth/api';
import { getRequestMetadata, hasTrustedOrigin } from '@/lib/auth/http';
import { githubErrorResponse } from '@/lib/github/api';
import { GitHubPatServiceError, githubPatService } from '@/lib/github/pat-service';

export async function DELETE(
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
    const { connectionId } = await params;
    if (!z.string().uuid().safeParse(connectionId).success) {
      throw new GitHubPatServiceError('CONNECTION_NOT_FOUND', 400);
    }
    await githubPatService.revokeConnection(actor, connectionId);
    const response = new NextResponse(null, { status: 204 });
    response.headers.set('cache-control', 'no-store');
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    return githubErrorResponse(error, metadata.requestId);
  }
}
