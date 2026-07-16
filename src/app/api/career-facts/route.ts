import { NextRequest, NextResponse } from 'next/server';

import { authFailureResponse, resolveActor } from '@/lib/auth/api';
import { getRequestMetadata } from '@/lib/auth/http';
import { careerErrorResponse, toCareerFact } from '@/lib/career/api';
import {
  CAREER_FACT_STATUSES,
  CAREER_FACT_TYPES,
  type CareerFactStatus,
  type CareerFactType,
} from '@/lib/career/types';
import { careerService } from '@/lib/career/service';

function invalidInput(message: string, requestId: string) {
  const response = NextResponse.json({ code: 'INVALID_INPUT', message, requestId }, { status: 400 });
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

export async function GET(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const rawStatus = request.nextUrl.searchParams.get('status');
    const rawType = request.nextUrl.searchParams.get('type');
    if (rawStatus && !CAREER_FACT_STATUSES.includes(rawStatus as CareerFactStatus)) {
      return invalidInput('Invalid status', metadata.requestId);
    }
    if (rawType && !CAREER_FACT_TYPES.includes(rawType as CareerFactType)) {
      return invalidInput('Invalid type', metadata.requestId);
    }
    const facts = await careerService.listFacts(actor, {
      ...(rawStatus ? { status: rawStatus as CareerFactStatus } : {}),
      ...(rawType ? { factType: rawType as CareerFactType } : {}),
    });
    const response = NextResponse.json(facts.map((fact) => toCareerFact(fact)));
    response.headers.set('cache-control', 'no-store');
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    return careerErrorResponse(error, metadata.requestId);
  }
}
