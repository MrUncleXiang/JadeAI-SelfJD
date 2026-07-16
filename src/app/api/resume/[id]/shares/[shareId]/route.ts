import { NextRequest, NextResponse } from 'next/server';
import { shareRepository } from '@/lib/db/repositories/share.repository';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { hashPassword } from '@/lib/utils/share';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; shareId: string }> }
) {
  try {
    const { id, shareId } = await params;
    const fingerprint = getUserIdFromRequest(request);
    const user = await resolveUser(fingerprint);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const share = await shareRepository.findOwnedById(user.id, id, shareId);
    if (!share) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const { label, password, isActive } = body as {
      label?: string;
      password?: string | null;
      isActive?: boolean;
    };

    const updates: { label?: string; password?: string | null; isActive?: boolean } = {};
    if (label !== undefined) updates.label = label;
    if (password !== undefined) {
      updates.password = password ? await hashPassword(password) : null;
    }
    if (isActive !== undefined) updates.isActive = isActive;

    const updated = await shareRepository.updateOwned(user.id, id, shareId, updates);
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({
      ...updated,
      hasPassword: !!updated?.password,
      password: undefined,
    });
  } catch (error) {
    console.error('PATCH /api/resume/[id]/shares/[shareId] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; shareId: string }> }
) {
  try {
    const { id, shareId } = await params;
    const fingerprint = getUserIdFromRequest(request);
    const user = await resolveUser(fingerprint);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const deleted = await shareRepository.deleteOwned(user.id, id, shareId);
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/resume/[id]/shares/[shareId] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
