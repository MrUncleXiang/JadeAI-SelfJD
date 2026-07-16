import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';

import { AuthRequestError, authErrorResponse, authFailureResponse, readAuthJson, toCurrentUser } from '@/lib/auth/api';
import { getRequestMetadata, hasTrustedOrigin, setSessionCookie } from '@/lib/auth/http';
import { authService } from '@/lib/auth/service';

const loginSchema = z.object({
  identifier: z.string().min(1).max(254),
  password: z.string().min(1).max(1024),
}).strict();

export async function POST(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  if (!hasTrustedOrigin(request)) {
    return authFailureResponse('UNTRUSTED_ORIGIN', metadata.requestId);
  }

  try {
    const input = await readAuthJson(request, loginSchema);
    const result = await authService.login(input, metadata);
    const response = NextResponse.json(toCurrentUser(result.user));
    setSessionCookie(response, result.token, result.expiresAt);
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    if (!(error instanceof AuthRequestError)) {
      // AuthService deliberately emits a uniform public credential error. The
      // server-side log must not include the submitted identifier or password.
      console.error('POST /api/auth/login failed:', error instanceof Error ? error.name : 'UnknownError');
    }
    return authErrorResponse(error, metadata.requestId);
  }
}
