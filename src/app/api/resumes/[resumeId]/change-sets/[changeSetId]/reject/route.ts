import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';

import { getUserIdFromRequest, resolveUser } from '@/lib/auth/helpers';
import { resumeChangeErrorResponse } from '@/lib/resume-patch/http';
import { resumeChangeService } from '@/lib/resume-patch/service';

const bodySchema = z.object({
  note: z.string().trim().max(500).optional(),
}).strict();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ resumeId: string; changeSetId: string }> },
) {
  try {
    const user = await resolveUser(getUserIdFromRequest(request));
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { resumeId, changeSetId } = await params;
    let note: string | undefined;
    if (request.headers.get('content-type')?.includes('application/json')) {
      const raw = await request.json().catch(() => ({}));
      const parsed = bodySchema.safeParse(raw || {});
      if (!parsed.success) {
        return NextResponse.json({ code: 'INVALID_INPUT', error: 'Invalid reject payload' }, { status: 400 });
      }
      note = parsed.data.note;
    }
    const changeSet = await resumeChangeService.reject({
      userId: user.id,
      resumeId,
      changeSetId,
      note,
    });
    return NextResponse.json(changeSet);
  } catch (error) {
    return resumeChangeErrorResponse(error);
  }
}
