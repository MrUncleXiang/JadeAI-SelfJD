import { NextRequest, NextResponse } from 'next/server';
import { resumeRepository } from '@/lib/db/repositories/resume.repository';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { resumeChangeRepository } from '@/lib/db/repositories/resume-change.repository';
import { createResumeSnapshot } from '@/lib/resume-patch/snapshot';

type SnapshotSectionInput = {
  id: string;
  type: string;
  title: string;
  sortOrder: number;
  visible: boolean;
  content: unknown;
};

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

    const resume = await resumeRepository.findOwnedById(user.id, id);
    if (!resume) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json(resume);
  } catch (error) {
    console.error('GET /api/resume/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
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

    const resume = await resumeRepository.findOwnedById(user.id, id);
    if (!resume) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = await request.json();
    const { title, template, themeConfig, language, sections } = body;
    if (sections !== undefined && (!Array.isArray(sections) || sections.length > 100)) {
      return NextResponse.json({ code: 'INVALID_SECTIONS', error: 'Invalid sections' }, { status: 400 });
    }

    const nextSections: SnapshotSectionInput[] = Array.isArray(sections)
      ? sections.map((section: Record<string, unknown>, index: number) => ({
          id: typeof section.id === 'string' ? section.id : '',
          type: typeof section.type === 'string' ? section.type : '',
          title: typeof section.title === 'string' ? section.title : '',
          sortOrder: index,
          visible: section.visible !== false,
          content: section.content,
        }))
      : resume.sections;
    if (nextSections.some((section: SnapshotSectionInput) => !section.id || !section.type || !section.title)
      || new Set(nextSections.map((section: SnapshotSectionInput) => section.id)).size !== nextSections.length) {
      return NextResponse.json({ code: 'INVALID_SECTIONS', error: 'Invalid section identifiers' }, { status: 400 });
    }

    const snapshot = createResumeSnapshot({
      ...resume,
      title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 240) : resume.title,
      template: typeof template === 'string' && template ? template : resume.template,
      themeConfig: themeConfig !== undefined ? themeConfig : resume.themeConfig,
      language: language === 'en' || language === 'zh' ? language : resume.language,
      sections: nextSections,
    });
    await resumeChangeRepository.saveManualSnapshotOwned(user.id, id, snapshot);

    const updated = await resumeRepository.findOwnedById(user.id, id);
    return NextResponse.json(updated);
  } catch (error) {
    console.error('PUT /api/resume/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
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

    const deleted = await resumeRepository.deleteOwned(user.id, id);
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/resume/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
