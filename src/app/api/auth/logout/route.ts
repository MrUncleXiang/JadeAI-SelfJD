import { NextRequest, NextResponse } from 'next/server';

import { authErrorResponse, authFailureResponse } from '@/lib/auth/api';
import { clearSessionCookie, getRequestMetadata, hasTrustedOrigin, readSessionToken } from '@/lib/auth/http';
import { authService } from '@/lib/auth/service';

export async function POST(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  if (!hasTrustedOrigin(request)) {
    return authFailureResponse('UNTRUSTED_ORIGIN', metadata.requestId);
  }

  try {
    await authService.logout(readSessionToken(request));
    const response = new NextResponse(null, { status: 204 });
    clearSessionCookie(response);
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    console.error('POST /api/auth/logout error:', error);
    return authErrorResponse(error, metadata.requestId);
  }
}
