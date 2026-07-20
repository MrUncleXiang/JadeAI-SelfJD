import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';

import {
  authErrorResponse,
  authFailureResponse,
  AuthRequestError,
  readAuthJson,
  resolveActor,
} from '@/lib/auth/api';
import { getRequestMetadata, hasTrustedOrigin } from '@/lib/auth/http';
import { AuthServiceError } from '@/lib/auth/service';
import { resumeChangeErrorResponse } from '@/lib/resume-patch/http';
import { TargetedResumeError, targetedResumeService } from '@/lib/resume/targeted';

const createSchema = z.object({
  baseResumeId: z.string().trim().min(1).max(100).optional(),
  baseVersionId: z.string().trim().min(1).max(100).optional(),
  title: z.string().trim().max(200).optional(),
  template: z.string().trim().min(1).max(100).optional(),
  language: z.enum(['zh', 'en']).optional(),
  instruction: z.string().trim().max(2_000).optional(),
}).strict().refine(
  (value) => !value.baseVersionId || Boolean(value.baseResumeId),
  { message: 'baseVersionId requires baseResumeId.' },
);

function errorResponse(error: unknown, requestId: string) {
  if (error instanceof AuthRequestError || error instanceof AuthServiceError) {
    return authErrorResponse(error, requestId);
  }
  if (error instanceof TargetedResumeError) {
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jdSourceId: string }> },
) {
  const metadata = getRequestMetadata(request);
  if (!hasTrustedOrigin(request)) return authFailureResponse('UNTRUSTED_ORIGIN', metadata.requestId);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const [{ jdSourceId }, input] = await Promise.all([
      params,
      readAuthJson(request, createSchema),
    ]);
    const result = await targetedResumeService.create({
      userId: actor.userId,
      jdSourceId,
      ...input,
      requestId: metadata.requestId,
      abortSignal: request.signal,
    });
    const response = NextResponse.json(result, { status: 201 });
    response.headers.set('cache-control', 'no-store');
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    return errorResponse(error, metadata.requestId);
  }
}
