import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';

import { toInvitation } from '@/lib/auth/admin-api';
import { adminAuthService } from '@/lib/auth/admin-service';
import {
  AuthRequestError,
  authErrorResponse,
  authFailureResponse,
  readAuthJson,
  resolveActor,
} from '@/lib/auth/api';
import { getRequestMetadata, hasTrustedOrigin } from '@/lib/auth/http';

const invitationSchema = z.object({
  maxUses: z.number().int().min(1).max(1000).optional(),
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
}).strict();

export async function GET(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const invitations = await adminAuthService.listInvitations(actor);
    const response = NextResponse.json(invitations.map(toInvitation));
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    return authErrorResponse(error, metadata.requestId);
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
    const input = await readAuthJson(request, invitationSchema);
    const result = await adminAuthService.createInvitation(actor, input);
    const response = NextResponse.json({
      ...toInvitation(result.invitation),
      code: result.code,
    }, { status: 201 });
    response.headers.set('cache-control', 'no-store');
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    if (!(error instanceof AuthRequestError)) {
      console.error('POST /api/admin/invitations error:', error instanceof Error ? error.name : 'UnknownError');
    }
    return authErrorResponse(error, metadata.requestId);
  }
}
