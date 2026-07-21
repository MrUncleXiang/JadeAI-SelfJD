import { NextRequest, NextResponse } from 'next/server';

import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { hasTrustedOrigin } from '@/lib/auth/http';
import { resumeChangeRepository } from '@/lib/db/repositories/resume-change.repository';
import { resumeRepository } from '@/lib/db/repositories/resume.repository';
import { createResumeSnapshot } from '@/lib/resume-patch/snapshot';
import {
  hasResumePersonalProfileContent,
  mergePersonalInfoPreferProfile,
  personalInfoContentFromProfile,
} from '@/lib/user/resume-personal-profile';
import { loadResumePersonalProfile } from '@/lib/user/resume-personal-profile-service';

type ResumeSectionForProfile = {
  id: string;
  resumeId: string;
  type: string;
  title: string;
  sortOrder: number;
  visible: boolean;
  content: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function personalInfoTitle(language: string) {
  return language === 'en' ? 'Personal Info' : '个人信息';
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (!hasTrustedOrigin(request)) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNTRUSTED_ORIGIN' }, { status: 401 });
    }

    const { id } = await params;
    const fingerprint = getUserIdFromRequest(request);
    const user = await resolveUser(fingerprint);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resume = await resumeRepository.findOwnedById(user.id, id);
    if (!resume) {
      return NextResponse.json({ error: 'Resume not found', code: 'RESUME_NOT_FOUND' }, { status: 404 });
    }

    const { profile, fallback } = await loadResumePersonalProfile(user.id);
    const profileContent = personalInfoContentFromProfile(profile, fallback);
    const hasAccountContent = hasResumePersonalProfileContent(profile)
      || Boolean(profileContent.fullName || profileContent.email);
    if (!hasAccountContent) {
      return NextResponse.json({ error: 'Resume personal profile is empty', code: 'RESUME_PROFILE_EMPTY' }, { status: 409 });
    }

    const sections = resume.sections as ResumeSectionForProfile[];
    const existing = sections.find((section) => section.type === 'personal_info');
    const mergedContent = mergePersonalInfoPreferProfile(existing?.content, profile, fallback);
    const nextSections = existing
      ? sections.map((section) => (
          section.id === existing.id
            ? { ...section, content: mergedContent, visible: true }
            : section
        ))
      : [{
          id: crypto.randomUUID(),
          resumeId: resume.id,
          type: 'personal_info',
          title: personalInfoTitle(resume.language),
          sortOrder: 0,
          visible: true,
          content: mergedContent,
          createdAt: new Date(),
          updatedAt: new Date(),
        }, ...sections];

    const snapshot = createResumeSnapshot({
      ...resume,
      sections: nextSections.map((section, index) => ({ ...section, sortOrder: index })),
    });
    await resumeChangeRepository.saveManualSnapshotOwned(user.id, id, snapshot);

    const updated = await resumeRepository.findOwnedById(user.id, id);
    return NextResponse.json(updated);
  } catch (error) {
    console.error('POST /api/resume/[id]/personal-info/apply-profile error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
