import { NextRequest, NextResponse } from 'next/server';
import { resumeRepository } from '@/lib/db/repositories/resume.repository';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { DEFAULT_SECTIONS } from '@/lib/constants';
import {
  personalInfoContentFromProfile,
  mergePersonalInfoPreferImported,
} from '@/lib/user/resume-personal-profile';
import { loadResumePersonalProfile } from '@/lib/user/resume-personal-profile-service';

export async function GET(request: NextRequest) {
  try {
    const fingerprint = getUserIdFromRequest(request);
    const user = await resolveUser(fingerprint);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resumes = await resumeRepository.findAllByUserId(user.id);
    return NextResponse.json(resumes);
  } catch (error) {
    console.error('GET /api/resume error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const fingerprint = getUserIdFromRequest(request);
    const user = await resolveUser(fingerprint);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { title, template, language, sections, themeConfig } = body;
    const { profile, fallback } = await loadResumePersonalProfile(user.id);
    const defaultPersonalInfo = personalInfoContentFromProfile(profile, fallback);

    const resume = await resumeRepository.createOwned(user.id, {
      title: title || defaultPersonalInfo.fullName || '未命名简历',
      template: template || 'classic',
      language: language || 'zh',
      ...(themeConfig ? { themeConfig } : {}),
    });

    if (resume) {
      if (Array.isArray(sections) && sections.length > 0) {
        // Import mode: use provided sections, ignore original ids.
        // If the import has no personal_info section, add one from the account profile
        // so every newly-created resume still has editable personal defaults.
        const importSections = sections.some((section) => section?.type === 'personal_info')
          ? sections
          : [{
              type: 'personal_info',
              title: (language || resume.language) === 'en' ? 'Personal Info' : '个人信息',
              visible: true,
              content: defaultPersonalInfo,
            }, ...sections];
        for (let i = 0; i < importSections.length; i++) {
          const s = importSections[i];
          const content = s.type === 'personal_info'
            ? mergePersonalInfoPreferImported(s.content, profile, fallback)
            : s.content;
          await resumeRepository.createSectionOwned(user.id, {
            resumeId: resume.id,
            type: s.type,
            title: s.title,
            sortOrder: i,
            visible: s.visible,
            content,
          });
        }
      } else {
        // Default mode: create empty sections, but seed personal_info from account profile
        const lang = resume.language || 'zh';
        for (let i = 0; i < DEFAULT_SECTIONS.length; i++) {
          const s = DEFAULT_SECTIONS[i];
          const sectionTitle = lang === 'en' ? s.titleEn : s.titleZh;
          let content: unknown = {};

          if (s.type === 'personal_info') {
            content = defaultPersonalInfo;
          } else if (s.type === 'summary') {
            content = { text: '' };
          } else if (s.type === 'work_experience' || s.type === 'education' || s.type === 'projects' || s.type === 'certifications' || s.type === 'languages' || s.type === 'github' || s.type === 'custom') {
            content = { items: [] };
          } else if (s.type === 'skills') {
            content = { categories: [] };
          }

          await resumeRepository.createSectionOwned(user.id, {
            resumeId: resume.id,
            type: s.type,
            title: sectionTitle,
            sortOrder: i,
            content,
          });
        }
      }

      const fullResume = await resumeRepository.findOwnedById(user.id, resume.id);
      return NextResponse.json(fullResume, { status: 201 });
    }

    return NextResponse.json({ error: 'Failed to create resume' }, { status: 500 });
  } catch (error) {
    console.error('POST /api/resume error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
