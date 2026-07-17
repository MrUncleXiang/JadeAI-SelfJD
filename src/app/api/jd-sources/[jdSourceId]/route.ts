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
import {
  JD_REQUIREMENT_PRIORITIES,
  JD_REQUIREMENT_TYPES,
} from '@/lib/jd/types';
import { jdService } from '@/lib/jd/service';

const requirementSchema = z.object({
  id: z.string().uuid().optional(),
  requirementType: z.enum(JD_REQUIREMENT_TYPES),
  text: z.string().trim().min(1).max(2_000),
  normalizedTerm: z.string().trim().max(240).optional(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  priority: z.enum(JD_REQUIREMENT_PRIORITIES).optional(),
  importance: z.number().min(0).max(1).optional(),
  sourceLocator: z.record(z.string(), z.unknown()).optional(),
}).strict();

const updateReviewSchema = z.object({
  title: z.string().trim().max(240).optional(),
  company: z.string().trim().max(240).optional(),
  jobTitle: z.string().trim().max(240).optional(),
  location: z.string().trim().max(240).optional(),
  requirements: z.array(requirementSchema).min(1).max(120),
}).strict();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jdSourceId: string }> },
) {
  const metadata = getRequestMetadata(request);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const { jdSourceId } = await params;
    return jdJson(toJdSource(await jdService.getSource(actor, jdSourceId)), metadata.requestId);
  } catch (error) {
    return jdErrorResponse(error, metadata.requestId);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ jdSourceId: string }> },
) {
  const metadata = getRequestMetadata(request);
  if (!hasTrustedOrigin(request)) return authFailureResponse('UNTRUSTED_ORIGIN', metadata.requestId);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const input = await readJdJson(request, updateReviewSchema);
    const { jdSourceId } = await params;
    return jdJson(toJdSource(await jdService.updateReview(actor, jdSourceId, input)), metadata.requestId);
  } catch (error) {
    return jdErrorResponse(error, metadata.requestId);
  }
}
