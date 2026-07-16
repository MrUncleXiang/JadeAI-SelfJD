import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';

import { authErrorResponse, authFailureResponse, readAuthJson, toCurrentUser } from '@/lib/auth/api';
import { getRequestMetadata, hasTrustedOrigin, setSessionCookie } from '@/lib/auth/http';
import { AuthRequestError } from '@/lib/auth/api';
import { authService } from '@/lib/auth/service';

const registerSchema = z.object({
  username: z.string().min(3).max(32),
  email: z.string().max(254).nullable().optional(),
  displayName: z.string().min(1).max(100).nullable().optional(),
  password: z.string().min(1).max(1024),
  invitationCode: z.string().min(1).max(512).nullable().optional(),
}).strict();

export async function GET(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  try {
    const mode = await authService.getRegistrationMode();
    const response = NextResponse.json({ mode });
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    console.error('GET /api/auth/register error:', error);
    return authErrorResponse(error, metadata.requestId);
  }
}

export async function POST(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  if (!hasTrustedOrigin(request)) {
    return authFailureResponse('UNTRUSTED_ORIGIN', metadata.requestId);
  }

  try {
    const input = await readAuthJson(request, registerSchema);
    const result = await authService.register(input, metadata);
    const response = NextResponse.json(toCurrentUser(result.user), { status: 201 });
    setSessionCookie(response, result.token, result.expiresAt);
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    if (!(error instanceof AuthRequestError)) {
      console.error('POST /api/auth/register error:', error);
    }
    return authErrorResponse(error, metadata.requestId);
  }
}
