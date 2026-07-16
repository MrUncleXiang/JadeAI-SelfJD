import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';

import {
  AuthRequestError,
  authFailureResponse,
  readAuthJson,
  resolveActor,
} from '@/lib/auth/api';
import { getRequestMetadata, hasTrustedOrigin } from '@/lib/auth/http';
import { llmErrorResponse, toLlmProfile } from '@/lib/llm/api';
import { llmProfileService } from '@/lib/llm/service';

const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  provider: z.enum(['openai-compatible', 'anthropic', 'gemini']).optional(),
  baseUrl: z.string().trim().min(1).max(2_048).optional(),
  modelName: z.string().trim().min(1).max(200).optional(),
  apiKey: z.string().trim().min(1).max(8_192).optional(),
}).strict().refine((input) => Object.keys(input).length > 0);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> },
) {
  const metadata = getRequestMetadata(request);
  if (!hasTrustedOrigin(request)) {
    return authFailureResponse('UNTRUSTED_ORIGIN', metadata.requestId);
  }
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const input = await readAuthJson(request, updateProfileSchema);
    const { profileId } = await params;
    const profile = await llmProfileService.updateProfile(actor, profileId, input);
    const response = NextResponse.json(toLlmProfile(profile));
    response.headers.set('cache-control', 'no-store');
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    if (!(error instanceof AuthRequestError)) {
      console.error('PATCH /api/llm-profiles/:profileId error:', error instanceof Error ? error.name : 'UnknownError');
    }
    return llmErrorResponse(error, metadata.requestId);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> },
) {
  const metadata = getRequestMetadata(request);
  if (!hasTrustedOrigin(request)) {
    return authFailureResponse('UNTRUSTED_ORIGIN', metadata.requestId);
  }
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const { profileId } = await params;
    await llmProfileService.deleteProfile(actor, profileId);
    const response = new NextResponse(null, { status: 204 });
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    console.error('DELETE /api/llm-profiles/:profileId error:', error instanceof Error ? error.name : 'UnknownError');
    return llmErrorResponse(error, metadata.requestId);
  }
}
