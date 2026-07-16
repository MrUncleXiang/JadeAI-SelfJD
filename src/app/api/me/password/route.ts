import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';

import {
  AuthRequestError,
  authErrorResponse,
  authFailureResponse,
  readAuthJson,
  resolveActor,
} from '@/lib/auth/api';
import { clearSessionCookie, getRequestMetadata, hasTrustedOrigin } from '@/lib/auth/http';
import { authService } from '@/lib/auth/service';

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(1).max(1024),
}).strict();

export async function POST(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  if (!hasTrustedOrigin(request)) {
    return authFailureResponse('UNTRUSTED_ORIGIN', metadata.requestId);
  }

  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const input = await readAuthJson(request, changePasswordSchema);
    await authService.changePassword(actor.userId, input.currentPassword, input.newPassword);
    const response = new NextResponse(null, { status: 204 });
    clearSessionCookie(response);
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    if (!(error instanceof AuthRequestError)) console.error('POST /api/me/password error:', error);
    return authErrorResponse(error, metadata.requestId);
  }
}
