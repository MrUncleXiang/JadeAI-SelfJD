import { NextRequest, NextResponse } from 'next/server';

import { adminAuthService } from '@/lib/auth/admin-service';
import { authErrorResponse, authFailureResponse, resolveActor } from '@/lib/auth/api';
import { getRequestMetadata, hasTrustedOrigin } from '@/lib/auth/http';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ invitationId: string }> },
) {
  const metadata = getRequestMetadata(request);
  if (!hasTrustedOrigin(request)) {
    return authFailureResponse('UNTRUSTED_ORIGIN', metadata.requestId);
  }
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const { invitationId } = await params;
    await adminAuthService.disableInvitation(actor, invitationId);
    const response = new NextResponse(null, { status: 204 });
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    console.error('DELETE /api/admin/invitations/:id error:', error instanceof Error ? error.name : 'UnknownError');
    return authErrorResponse(error, metadata.requestId);
  }
}
