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

const createProfileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  provider: z.enum(['openai-compatible', 'anthropic', 'gemini']),
  baseUrl: z.string().trim().min(1).max(2_048),
  modelName: z.string().trim().min(1).max(200),
  apiKey: z.string().trim().min(1).max(8_192),
}).strict();

export async function GET(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const profiles = await llmProfileService.listProfiles(actor);
    const response = NextResponse.json(profiles.map(toLlmProfile));
    response.headers.set('cache-control', 'no-store');
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    return llmErrorResponse(error, metadata.requestId);
  }
}

export async function POST(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  if (!hasTrustedOrigin(request)) {
    return authFailureResponse('UNTRUSTED_ORIGIN', metadata.requestId);
  }
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const input = await readAuthJson(request, createProfileSchema);
    const profile = await llmProfileService.createProfile(actor, input);
    const response = NextResponse.json(toLlmProfile(profile), { status: 201 });
    response.headers.set('cache-control', 'no-store');
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    if (!(error instanceof AuthRequestError)) {
      console.error('POST /api/llm-profiles error:', error instanceof Error ? error.name : 'UnknownError');
    }
    return llmErrorResponse(error, metadata.requestId);
  }
}
