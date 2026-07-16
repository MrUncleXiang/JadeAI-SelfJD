import { NextRequest, NextResponse } from 'next/server';

import { getUserIdFromRequest, resolveUser } from '@/lib/auth/helpers';
import { resumeChangeErrorResponse } from '@/lib/resume-patch/http';
import { resumeChangeService } from '@/lib/resume-patch/service';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resumeId: string; changeSetId: string }> },
) {
  try {
    const user = await resolveUser(getUserIdFromRequest(request));
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { resumeId, changeSetId } = await params;
    return NextResponse.json(await resumeChangeService.getChangeSet(user.id, resumeId, changeSetId));
  } catch (error) {
    return resumeChangeErrorResponse(error);
  }
}
