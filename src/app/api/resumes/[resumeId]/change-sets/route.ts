import { NextRequest, NextResponse } from 'next/server';

import { getUserIdFromRequest, resolveUser } from '@/lib/auth/helpers';
import { resumeChangeErrorResponse } from '@/lib/resume-patch/http';
import { resumeChangeService } from '@/lib/resume-patch/service';

async function actor(request: NextRequest) {
  return resolveUser(getUserIdFromRequest(request));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resumeId: string }> },
) {
  try {
    const user = await actor(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { resumeId } = await params;
    return NextResponse.json(await resumeChangeService.listChangeSets(user.id, resumeId));
  } catch (error) {
    return resumeChangeErrorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ resumeId: string }> },
) {
  try {
    const user = await actor(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { resumeId } = await params;
    const body = await request.json();
    const baseVersionId = typeof body?.baseVersionId === 'string' ? body.baseVersionId : undefined;
    const requestId = request.headers.get('x-request-id');
    // Accepting an already structured candidate is useful for trusted automation and
    // deterministic acceptance tests. It does not bypass tenant, schema, evidence,
    // hash, diff, or apply validation and never writes to the live resume here.
    const changeSet = body?.candidate !== undefined
      ? await resumeChangeService.createFromCandidate({
        userId: user.id,
        resumeId,
        baseVersionId,
        candidate: body.candidate,
        requestId,
      })
      : await resumeChangeService.propose({
        userId: user.id,
        resumeId,
        baseVersionId,
        instruction: typeof body?.instruction === 'string' ? body.instruction : '',
        requestId,
        abortSignal: request.signal,
      });
    return NextResponse.json(changeSet, { status: 201 });
  } catch (error) {
    return resumeChangeErrorResponse(error);
  }
}
