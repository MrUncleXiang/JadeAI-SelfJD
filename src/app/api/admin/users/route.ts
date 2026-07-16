import { NextRequest, NextResponse } from 'next/server';

import { adminAuthService } from '@/lib/auth/admin-service';
import { toAdminUser } from '@/lib/auth/admin-api';
import { authErrorResponse, authFailureResponse, resolveActor } from '@/lib/auth/api';
import { AuthServiceError } from '@/lib/auth/service';
import { getRequestMetadata } from '@/lib/auth/http';

const USER_STATUSES = new Set(['active', 'disabled', 'pending']);

export async function GET(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const page = Number(request.nextUrl.searchParams.get('page') || 1);
    const pageSize = Number(request.nextUrl.searchParams.get('pageSize') || 20);
    const statusValue = request.nextUrl.searchParams.get('status');
    if (
      !Number.isInteger(page)
      || !Number.isInteger(pageSize)
      || page < 1
      || pageSize < 1
      || pageSize > 100
      || (statusValue && !USER_STATUSES.has(statusValue))
    ) {
      throw new AuthServiceError('INVALID_INPUT', 400);
    }
    const result = await adminAuthService.listUsers(actor, {
      page,
      pageSize,
      query: request.nextUrl.searchParams.get('query'),
      status: statusValue as 'active' | 'disabled' | 'pending' | null,
    });
    const response = NextResponse.json({
      items: result.items.map(toAdminUser),
      total: result.total,
      page,
      pageSize,
    });
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    console.error('GET /api/admin/users error:', error instanceof Error ? error.name : 'UnknownError');
    return authErrorResponse(error, metadata.requestId);
  }
}
