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

const reviewSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(2_000).optional(),
}).strict();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ factId: string }> },
) {
  const metadata = getRequestMetadata(request);
  if (!hasTrustedOrigin(request)) return authFailureResponse('UNTRUSTED_ORIGIN', metadata.requestId);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const input = await readAuthJson(request, reviewSchema);
    const { factId } = await params;
    const fact = await careerService.reviewFact(actor, factId, input.decision, input.note);
    const response = NextResponse.json(toCareerFact(fact));
    response.headers.set('cache-control', 'no-store');
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    return careerErrorResponse(error, metadata.requestId);
  }
}
