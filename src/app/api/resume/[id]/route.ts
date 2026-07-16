import { NextRequest, NextResponse } from 'next/server';
import { resumeRepository } from '@/lib/db/repositories/resume.repository';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { resumeSections } from '@/lib/db/schema';

type ResumeSectionRow = typeof resumeSections.$inferSelect;

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
    const { title, template, themeConfig, sections } = body;

    // Update resume metadata
    if (title || template || themeConfig) {
      await resumeRepository.updateOwned(user.id, id, {
        ...(title && { title }),
        ...(template && { template }),
        ...(themeConfig && { themeConfig }),
      });
    }

    // Sync sections: create new, update existing, delete removed
    if (sections && Array.isArray(sections)) {
      const existingSections = resume.sections || [];
      const existingIds = new Set(existingSections.map((section: ResumeSectionRow) => section.id));
      const incomingIds = new Set(sections.map((section: { id: string }) => section.id));

      // Delete sections that were removed by the user
      for (const existing of existingSections) {
        if (!incomingIds.has(existing.id)) {
          await resumeRepository.deleteSectionOwned(user.id, id, existing.id);
        }
      }

      for (const section of sections) {
        if (existingIds.has(section.id)) {
          // Update existing section
          await resumeRepository.updateSectionOwned(user.id, id, section.id, {
            title: section.title,
            sortOrder: section.sortOrder,
            visible: section.visible,
            content: section.content,
          });
        } else {
          // Create new section added by the user
          await resumeRepository.createSectionOwned(user.id, {
            id: section.id,
            resumeId: id,
            type: section.type,
            title: section.title,
            sortOrder: section.sortOrder,
            visible: section.visible,
            content: section.content,
          });
        }
      }
    }

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
