import { NextRequest } from 'next/server';
import { z } from 'zod/v4';

import { authFailureResponse, resolveActor } from '@/lib/auth/api';
import { getRequestMetadata, hasTrustedOrigin } from '@/lib/auth/http';
import {
  jdErrorResponse,
  jdJson,
  readJdJson,
  toJdSource,
} from '@/lib/jd/api';
import { jdService } from '@/lib/jd/service';

const createTextSchema = z.object({
  text: z.string().min(1).max(100_000),
  title: z.string().trim().max(240).optional(),
}).strict();

export async function GET(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const sources = await jdService.listSources(actor);
    return jdJson(sources.map((source) => toJdSource(source)), metadata.requestId);
  } catch (error) {
    return jdErrorResponse(error, metadata.requestId);
  }
}

export async function POST(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  if (!hasTrustedOrigin(request)) return authFailureResponse('UNTRUSTED_ORIGIN', metadata.requestId);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const input = await readJdJson(request, createTextSchema);
    const result = await jdService.createTextSource(actor, input);
    return jdJson({
      ...toJdSource(result.source),
      deduplicated: !result.created,
    }, metadata.requestId, result.created ? 201 : 200);
  } catch (error) {
    return jdErrorResponse(error, metadata.requestId);
  }
}
