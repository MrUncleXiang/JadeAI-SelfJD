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
import { CAREER_FACT_TYPES } from '@/lib/career/types';

const mergeSchema = z.object({
  factIds: z.array(z.string().min(1)).min(2).max(20),
  factType: z.enum(CAREER_FACT_TYPES),
  title: z.string().min(1).max(200),
  summary: z.string().max(5_000),
  structuredData: z.record(z.string(), z.unknown()).optional(),
}).strict();

export async function POST(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  if (!hasTrustedOrigin(request)) return authFailureResponse('UNTRUSTED_ORIGIN', metadata.requestId);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const input = await readAuthJson(request, mergeSchema);
    const fact = await careerService.mergeFacts(actor, input);
    const response = NextResponse.json(toCareerFact(fact), { status: 201 });
    response.headers.set('cache-control', 'no-store');
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    return careerErrorResponse(error, metadata.requestId);
  }
}
