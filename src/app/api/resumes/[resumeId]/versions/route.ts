import { NextRequest, NextResponse } from 'next/server';

import { getUserIdFromRequest, resolveUser } from '@/lib/auth/helpers';
import { resumeChangeErrorResponse } from '@/lib/resume-patch/http';
import { resumeChangeService } from '@/lib/resume-patch/service';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resumeId: string }> },
) {
  try {
    const user = await resolveUser(getUserIdFromRequest(request));
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { resumeId } = await params;
    return NextResponse.json(await resumeChangeService.listVersions(user.id, resumeId));
  } catch (error) {
    return resumeChangeErrorResponse(error);
  }
}
