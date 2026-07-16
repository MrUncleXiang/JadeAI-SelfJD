import { NextRequest, NextResponse } from 'next/server';

import { authFailureResponse, resolveActor } from '@/lib/auth/api';
import { getRequestMetadata } from '@/lib/auth/http';
import { llmErrorResponse } from '@/lib/llm/api';
import { llmProfileService } from '@/lib/llm/service';

export async function GET(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const bindings = await llmProfileService.listBindings(actor);
    const response = NextResponse.json(bindings);
    response.headers.set('cache-control', 'no-store');
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    return llmErrorResponse(error, metadata.requestId);
  }
}
