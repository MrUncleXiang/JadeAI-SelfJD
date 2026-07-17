import { NextRequest, NextResponse } from 'next/server';

import { authFailureResponse, resolveActor } from '@/lib/auth/api';
import { getRequestMetadata } from '@/lib/auth/http';
import { GitHubServiceError, githubConnectionService } from '@/lib/github/service';

function redirect(request: NextRequest, path: string, status: string) {
  const url = new URL(path, request.nextUrl.origin);
  url.searchParams.set('github', status);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  const { actor } = await resolveActor(request, metadata);
  if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
  const state = request.nextUrl.searchParams.get('state');
  const installationId = request.nextUrl.searchParams.get('installation_id');
  const setupAction = request.nextUrl.searchParams.get('setup_action');
  if (!state || !installationId || setupAction === 'request') {
    return redirect(request, '/zh/knowledge', 'cancelled');
  }
  try {
    const result = await githubConnectionService.completeConnection(actor, { state, installationId });
    return redirect(request, result.returnPath, 'connected');
  } catch (error) {
    const code = error instanceof GitHubServiceError ? error.code.toLowerCase() : 'failed';
    return redirect(request, '/zh/knowledge', code);
  }
}
