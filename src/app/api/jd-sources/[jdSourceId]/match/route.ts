import { NextRequest, NextResponse } from 'next/server';

import {
  authErrorResponse,
  authFailureResponse,
  AuthRequestError,
  resolveActor,
} from '@/lib/auth/api';
import { getRequestMetadata, hasTrustedOrigin } from '@/lib/auth/http';
import { AuthServiceError } from '@/lib/auth/service';
import { JdMatchError, jdMatchService } from '@/lib/jd/match-service';

function errorResponse(error: unknown, requestId: string) {
  if (error instanceof AuthRequestError || error instanceof AuthServiceError) {
    return authErrorResponse(error, requestId);
  }
  if (error instanceof JdMatchError) {
    const response = NextResponse.json({
      code: error.code,
      message: error.message,
      requestId,
    }, { status: error.status });
    response.headers.set('cache-control', 'no-store');
    response.headers.set('x-request-id', requestId);
    return response;
  }
  console.error('JD match route failed:', error instanceof Error ? error.name : 'UnknownError');
  const response = NextResponse.json({
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
    requestId,
  }, { status: 500 });
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

async function handle(
  request: NextRequest,
  params: Promise<{ jdSourceId: string }>,
) {
  const metadata = getRequestMetadata(request);
  if (!hasTrustedOrigin(request)) return authFailureResponse('UNTRUSTED_ORIGIN', metadata.requestId);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const { jdSourceId } = await params;
    const report = await jdMatchService.analyzeOwned(actor.userId, jdSourceId);
    const response = NextResponse.json(report, { status: 200 });
    response.headers.set('cache-control', 'no-store');
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    return errorResponse(error, metadata.requestId);
  }
}

/** Synchronous match matrix for confirmed JD + approved facts [JD-003]. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ jdSourceId: string }> },
) {
  return handle(request, context.params);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ jdSourceId: string }> },
) {
  return handle(request, context.params);
}
