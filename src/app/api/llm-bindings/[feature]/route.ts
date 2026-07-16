import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';

import {
  AuthRequestError,
  authFailureResponse,
  readAuthJson,
  resolveActor,
} from '@/lib/auth/api';
import { getRequestMetadata, hasTrustedOrigin } from '@/lib/auth/http';
import { llmErrorResponse } from '@/lib/llm/api';
import { LLM_FEATURES, llmProfileService } from '@/lib/llm/service';
import type { LlmFeature } from '@/lib/db/repositories/llm-profile.repository';

const bindingSchema = z.object({
  profileId: z.string().uuid().nullable(),
}).strict();

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ feature: string }> },
) {
  const metadata = getRequestMetadata(request);
  if (!hasTrustedOrigin(request)) {
    return authFailureResponse('UNTRUSTED_ORIGIN', metadata.requestId);
  }
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const { feature } = await params;
    if (!LLM_FEATURES.includes(feature as LlmFeature)) {
      return NextResponse.json({
        code: 'INVALID_INPUT',
        message: 'Unknown LLM feature',
        requestId: metadata.requestId,
      }, { status: 400, headers: { 'x-request-id': metadata.requestId } });
    }
    const input = await readAuthJson(request, bindingSchema);
    const binding = await llmProfileService.setBinding(
      actor,
      feature as LlmFeature,
      input.profileId,
    );
    const response = NextResponse.json(binding);
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    if (!(error instanceof AuthRequestError)) {
      console.error('PUT /api/llm-bindings/:feature error:', error instanceof Error ? error.name : 'UnknownError');
    }
    return llmErrorResponse(error, metadata.requestId);
  }
}
