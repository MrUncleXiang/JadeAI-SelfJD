import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';

import {
  AuthRequestError,
  authErrorResponse,
  authFailureResponse,
  readAuthJson,
  resolveActor,
  toCurrentUser,
} from '@/lib/auth/api';
import { getRequestMetadata, hasTrustedOrigin, readSessionToken } from '@/lib/auth/http';
import { authService } from '@/lib/auth/service';

const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  email: z.string().max(254).nullable().optional(),
}).strict().refine((value) => value.displayName !== undefined || value.email !== undefined);

export async function GET(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const response = NextResponse.json(toCurrentUser(actor.user));
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    console.error('GET /api/me error:', error);
    return authErrorResponse(error, metadata.requestId);
  }
}

export async function PATCH(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  if (!hasTrustedOrigin(request)) {
    return authFailureResponse('UNTRUSTED_ORIGIN', metadata.requestId);
  }

  try {
    const actor = await authService.resolveSession(readSessionToken(request), metadata.requestId);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const input = await readAuthJson(request, updateProfileSchema);
    const user = await authService.updateProfile(actor.userId, input, metadata.requestId);
    const response = NextResponse.json(toCurrentUser(user));
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    if (!(error instanceof AuthRequestError)) console.error('PATCH /api/me error:', error);
    return authErrorResponse(error, metadata.requestId);
  }
}
