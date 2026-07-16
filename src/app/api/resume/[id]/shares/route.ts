import { NextRequest, NextResponse } from 'next/server';
import { shareRepository } from '@/lib/db/repositories/share.repository';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { generateShareToken, getShareUrl, hashPassword } from '@/lib/utils/share';
import { resumeShares } from '@/lib/db/schema';

type ResumeShareRow = typeof resumeShares.$inferSelect;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const fingerprint = getUserIdFromRequest(request);
    const user = await resolveUser(fingerprint);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const shares = await shareRepository.findOwnedByResumeId(user.id, id);
    if (!shares) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const sharesWithUrl = shares.map((share: ResumeShareRow) => ({
      ...share,
      shareUrl: getShareUrl(share.token, request),
      hasPassword: !!share.password,
      password: undefined,
    }));

    return NextResponse.json(sharesWithUrl);
  } catch (error) {
    console.error('GET /api/resume/[id]/shares error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const fingerprint = getUserIdFromRequest(request);
    const user = await resolveUser(fingerprint);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { label, password } = body as { label?: string; password?: string };

    const token = generateShareToken();
    const hashedPassword = password ? await hashPassword(password) : null;

    const share = await shareRepository.createOwned(user.id, {
      resumeId: id,
      token,
      label: label || '',
      password: hashedPassword,
    });
    if (!share) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({
      ...share,
      shareUrl: getShareUrl(token, request),
      hasPassword: !!hashedPassword,
      password: undefined,
    }, { status: 201 });
  } catch (error) {
    console.error('POST /api/resume/[id]/shares error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
