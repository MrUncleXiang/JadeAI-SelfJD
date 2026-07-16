import { NextRequest, NextResponse } from 'next/server';

import { getUserIdFromRequest, resolveUser } from '@/lib/auth/helpers';
import { resumeChangeErrorResponse } from '@/lib/resume-patch/http';
import { resumeChangeService } from '@/lib/resume-patch/service';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ resumeId: string; versionId: string }> },
) {
  try {
    const user = await resolveUser(getUserIdFromRequest(request));
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { resumeId, versionId } = await params;
    return NextResponse.json(await resumeChangeService.restore(user.id, resumeId, versionId));
  } catch (error) {
    return resumeChangeErrorResponse(error);
  }
}
