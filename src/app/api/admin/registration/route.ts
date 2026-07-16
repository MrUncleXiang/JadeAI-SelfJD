import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';

import { adminAuthService } from '@/lib/auth/admin-service';
import {
  AuthRequestError,
  authErrorResponse,
  authFailureResponse,
  readAuthJson,
  resolveActor,
} from '@/lib/auth/api';
import { getRequestMetadata, hasTrustedOrigin } from '@/lib/auth/http';

const registrationSchema = z.object({
  mode: z.enum(['closed', 'invite', 'open']),
}).strict();

export async function GET(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const mode = await adminAuthService.getRegistrationMode(actor);
    const response = NextResponse.json({ mode });
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    return authErrorResponse(error, metadata.requestId);
  }
}

export async function PATCH(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  if (!hasTrustedOrigin(request)) {
    return authFailureResponse('UNTRUSTED_ORIGIN', metadata.requestId);
  }
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const input = await readAuthJson(request, registrationSchema);
    await adminAuthService.setRegistrationMode(actor, input.mode);
    const response = NextResponse.json({ mode: input.mode });
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    if (!(error instanceof AuthRequestError)) {
      console.error('PATCH /api/admin/registration error:', error instanceof Error ? error.name : 'UnknownError');
    }
    return authErrorResponse(error, metadata.requestId);
  }
}
