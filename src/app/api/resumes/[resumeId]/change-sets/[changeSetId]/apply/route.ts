import { NextRequest, NextResponse } from 'next/server';

import { getUserIdFromRequest, resolveUser } from '@/lib/auth/helpers';
import { resumeChangeErrorResponse } from '@/lib/resume-patch/http';
import { resumeChangeService } from '@/lib/resume-patch/service';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ resumeId: string; changeSetId: string }> },
) {
  try {
    const user = await resolveUser(getUserIdFromRequest(request));
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { resumeId, changeSetId } = await params;
    const body = await request.json();
    const operationIds = Array.isArray(body?.operationIds)
      ? body.operationIds.filter((value: unknown): value is string => typeof value === 'string')
      : [];
    return NextResponse.json(await resumeChangeService.apply({
      userId: user.id,
      resumeId,
      changeSetId,
      operationIds,
    }));
  } catch (error) {
    return resumeChangeErrorResponse(error);
  }
}
