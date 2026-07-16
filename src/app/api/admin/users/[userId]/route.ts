import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';

import { toAdminUser } from '@/lib/auth/admin-api';
import { adminAuthService } from '@/lib/auth/admin-service';
import {
  AuthRequestError,
  authErrorResponse,
  authFailureResponse,
  readAuthJson,
  resolveActor,
} from '@/lib/auth/api';
import { getRequestMetadata, hasTrustedOrigin } from '@/lib/auth/http';

const updateUserSchema = z.object({
  role: z.enum(['admin', 'user']).optional(),
  status: z.enum(['active', 'disabled', 'pending']).optional(),
}).strict().refine((value) => value.role !== undefined || value.status !== undefined);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const metadata = getRequestMetadata(request);
  if (!hasTrustedOrigin(request)) {
    return authFailureResponse('UNTRUSTED_ORIGIN', metadata.requestId);
  }

  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const input = await readAuthJson(request, updateUserSchema);
    const { userId } = await params;
    const user = await adminAuthService.updateUser(actor, userId, input);
    const response = NextResponse.json(toAdminUser(user));
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    if (!(error instanceof AuthRequestError)) {
      console.error('PATCH /api/admin/users/:userId error:', error instanceof Error ? error.name : 'UnknownError');
    }
    return authErrorResponse(error, metadata.requestId);
  }
}
