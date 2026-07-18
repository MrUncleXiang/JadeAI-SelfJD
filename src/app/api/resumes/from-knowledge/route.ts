import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';

import {
  authFailureResponse,
  readAuthJson,
  resolveActor,
} from '@/lib/auth/api';
import { getRequestMetadata, hasTrustedOrigin } from '@/lib/auth/http';
import { resumeChangeErrorResponse } from '@/lib/resume-patch/http';
import { KnowledgeResumeError, knowledgeResumeService } from '@/lib/resume/from-knowledge';

const createSchema = z.object({
  title: z.string().trim().max(200).optional(),
  template: z.string().trim().min(1).max(100).optional(),
  language: z.enum(['zh', 'en']).optional(),
  targetRole: z.string().trim().max(240).optional(),
  instruction: z.string().trim().max(2_000).optional(),
}).strict();

function errorResponse(error: unknown, requestId: string) {
  if (error instanceof KnowledgeResumeError) {
    const response = NextResponse.json({
      code: error.code,
      message: error.message,
      requestId,
    }, { status: error.status });
    response.headers.set('cache-control', 'no-store');
    response.headers.set('x-request-id', requestId);
    return response;
  }
  const response = resumeChangeErrorResponse(error);
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

export async function POST(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  if (!hasTrustedOrigin(request)) return authFailureResponse('UNTRUSTED_ORIGIN', metadata.requestId);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const input = await readAuthJson(request, createSchema);
    const result = await knowledgeResumeService.create({
      userId: actor.userId,
      ...input,
      requestId: metadata.requestId,
    });
    const response = NextResponse.json(result, { status: 201 });
    response.headers.set('cache-control', 'no-store');
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    return errorResponse(error, metadata.requestId);
  }
}
