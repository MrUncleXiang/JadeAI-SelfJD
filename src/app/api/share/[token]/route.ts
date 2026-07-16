import { NextRequest, NextResponse } from 'next/server';
import { resumeRepository } from '@/lib/db/repositories/resume.repository';
import { shareRepository } from '@/lib/db/repositories/share.repository';
import { hashPassword } from '@/lib/utils/share';

function toPublicResume(resume: Record<string, unknown>) {
  const publicResume = { ...resume };
  delete publicResume.userId;
  delete publicResume.sharePassword;
  return publicResume;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const password = request.nextUrl.searchParams.get('password');

    // 1. Try new resume_shares table first
    const bundle = await shareRepository.findPublicBundleByToken(token);
    if (bundle) {
      const { share, resume } = bundle;
      console.log('[share/token] found in resumeShares, isActive:', share.isActive, typeof share.isActive);
      if (!share.isActive) {
        return NextResponse.json({ error: 'This share link has been disabled' }, { status: 403 });
      }

      if (share.password) {
        if (!password) {
          return NextResponse.json(
            { error: 'Password required', passwordRequired: true },
            { status: 401 }
          );
        }
        const hashedInput = await hashPassword(password);
        if (hashedInput !== share.password) {
          return NextResponse.json(
            { error: 'Invalid password', passwordRequired: true },
            { status: 401 }
          );
        }
      }

      await shareRepository.incrementPublicViewCount(share.id);

      return NextResponse.json(toPublicResume(resume));
    }

    // 2. Fallback to legacy resumes.shareToken
    const resume = await resumeRepository.findPublicByLegacyShareToken(token);
    if (!resume) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (!resume.isPublic) {
      return NextResponse.json({ error: 'This resume is not shared' }, { status: 403 });
    }

    if (resume.sharePassword) {
      if (!password) {
        return NextResponse.json(
          { error: 'Password required', passwordRequired: true },
          { status: 401 }
        );
      }
      const hashedInput = await hashPassword(password);
      if (hashedInput !== resume.sharePassword) {
        return NextResponse.json(
          { error: 'Invalid password', passwordRequired: true },
          { status: 401 }
        );
      }
    }

    await resumeRepository.incrementPublicViewCount(resume.id);

    return NextResponse.json(toPublicResume(resume));
  } catch (error) {
    console.error('GET /api/share/[token] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
