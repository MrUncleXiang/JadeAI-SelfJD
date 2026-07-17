import { NextRequest } from 'next/server';

import { authFailureResponse, resolveActor } from '@/lib/auth/api';
import { getRequestMetadata, hasTrustedOrigin } from '@/lib/auth/http';
import { jdErrorResponse, jdJson, toJdSource } from '@/lib/jd/api';
import { jdService } from '@/lib/jd/service';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jdSourceId: string }> },
) {
  const metadata = getRequestMetadata(request);
  if (!hasTrustedOrigin(request)) return authFailureResponse('UNTRUSTED_ORIGIN', metadata.requestId);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const { jdSourceId } = await params;
    const source = await jdService.extractSource(actor, jdSourceId);
    return jdJson(toJdSource(source), metadata.requestId);
  } catch (error) {
    return jdErrorResponse(error, metadata.requestId);
  }
}
