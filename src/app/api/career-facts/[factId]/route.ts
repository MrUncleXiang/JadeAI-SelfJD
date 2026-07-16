import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';

import {
  authFailureResponse,
  readAuthJson,
  resolveActor,
} from '@/lib/auth/api';
import { getRequestMetadata, hasTrustedOrigin } from '@/lib/auth/http';
import { careerErrorResponse, toCareerFact } from '@/lib/career/api';
import { careerService } from '@/lib/career/service';

const updateFactSchema = z.object({
  title: z.string().max(200).optional(),
  summary: z.string().max(5_000).optional(),
  structuredData: z.record(z.string(), z.unknown()).optional(),
}).strict().refine((input) => Object.keys(input).length > 0);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ factId: string }> },
) {
  const metadata = getRequestMetadata(request);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const { factId } = await params;
    const fact = await careerService.getFact(actor, factId);
    const response = NextResponse.json(toCareerFact(fact));
    response.headers.set('cache-control', 'no-store');
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    return careerErrorResponse(error, metadata.requestId);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ factId: string }> },
) {
  const metadata = getRequestMetadata(request);
  if (!hasTrustedOrigin(request)) return authFailureResponse('UNTRUSTED_ORIGIN', metadata.requestId);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const input = await readAuthJson(request, updateFactSchema);
    const { factId } = await params;
    const fact = await careerService.updateFact(actor, factId, input);
    const response = NextResponse.json(toCareerFact(fact));
    response.headers.set('cache-control', 'no-store');
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    return careerErrorResponse(error, metadata.requestId);
  }
}
