import { NextResponse, type NextRequest } from 'next/server';
import type { ZodType } from 'zod/v4';

import { AuthServiceError, authService, type SafeUser } from './service';
import { getRequestMetadata, readSessionToken } from './http';

const MAX_AUTH_BODY_BYTES = 16 * 1024;

export class AuthRequestError extends Error {
  constructor(
    public readonly code: 'INVALID_JSON' | 'INVALID_INPUT' | 'PAYLOAD_TOO_LARGE' | 'UNSUPPORTED_MEDIA_TYPE',
    public readonly status: number,
  ) {
    super(code);
    this.name = 'AuthRequestError';
  }
}

export async function readAuthJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new AuthRequestError('UNSUPPORTED_MEDIA_TYPE', 415);
  }

  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_AUTH_BODY_BYTES) {
    throw new AuthRequestError('PAYLOAD_TOO_LARGE', 413);
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_AUTH_BODY_BYTES) {
    throw new AuthRequestError('PAYLOAD_TOO_LARGE', 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AuthRequestError('INVALID_JSON', 400);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new AuthRequestError('INVALID_INPUT', 400);
  return result.data;
}

export function toCurrentUser(user: SafeUser) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.name || user.username || '',
    avatarUrl: user.avatarUrl,
    role: user.role,
    status: user.status,
    authType: user.authType,
  };
}

export async function resolveActor(
  request: NextRequest,
  metadata = getRequestMetadata(request),
) {
  const actor = await authService.resolveSession(readSessionToken(request), metadata.requestId);
  return { actor, metadata };
}

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_JSON: 'Request body must be valid JSON',
  INVALID_INPUT: 'Request data is invalid',
  PAYLOAD_TOO_LARGE: 'Request body is too large',
  UNSUPPORTED_MEDIA_TYPE: 'Content-Type must be application/json',
  REGISTRATION_CLOSED: 'Registration is closed',
  INVITATION_REQUIRED: 'An invitation code is required',
  INVALID_INVITATION: 'Invitation code is invalid or expired',
  IDENTIFIER_CONFLICT: 'Username or email is already in use',
  INVALID_CREDENTIALS: 'Invalid username/email or password',
  TOO_MANY_ATTEMPTS: 'Too many login attempts. Try again later',
  INVALID_PASSWORD: 'Password does not meet the security requirements',
  BOOTSTRAP_DISABLED: 'An active administrator already exists',
  FORBIDDEN: 'Administrator access is required',
  USER_NOT_FOUND: 'User not found',
  RESOURCE_NOT_FOUND: 'Resource not found',
  LAST_ADMIN: 'The last active administrator cannot be disabled or demoted',
  UNAUTHORIZED: 'Authentication required',
  UNTRUSTED_ORIGIN: 'Request origin is not allowed',
  INTERNAL_ERROR: 'Internal server error',
};

export function authErrorResponse(error: unknown, requestId: string): NextResponse {
  let code = 'INTERNAL_ERROR';
  let status = 500;
  if (error instanceof AuthServiceError || error instanceof AuthRequestError) {
    code = error.code;
    status = error.status;
  }
  const response = NextResponse.json(
    { code, message: ERROR_MESSAGES[code] || ERROR_MESSAGES.INTERNAL_ERROR, requestId },
    { status },
  );
  if (error instanceof AuthServiceError && error.retryAfterSeconds) {
    response.headers.set('retry-after', String(error.retryAfterSeconds));
  }
  response.headers.set('x-request-id', requestId);
  return response;
}

export function authFailureResponse(
  code: 'UNAUTHORIZED' | 'UNTRUSTED_ORIGIN',
  requestId: string,
  status = code === 'UNAUTHORIZED' ? 401 : 403,
): NextResponse {
  const response = NextResponse.json(
    { code, message: ERROR_MESSAGES[code], requestId },
    { status },
  );
  response.headers.set('x-request-id', requestId);
  return response;
}
