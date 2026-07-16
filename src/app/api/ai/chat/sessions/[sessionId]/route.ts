import { NextRequest, NextResponse } from 'next/server';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { chatRepository } from '@/lib/db/repositories/chat.repository';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const fingerprint = getUserIdFromRequest(request);
    const user = await resolveUser(fingerprint);
    if (!user) return new Response('Unauthorized', { status: 401 });

    const { sessionId } = await params;

    const cursor = request.nextUrl.searchParams.get('cursor') || undefined;
    const limitParam = request.nextUrl.searchParams.get('limit');
    const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 20, 50) : 20;

    const session = await chatRepository.findOwnedSession(user.id, sessionId);
    if (!session) return new Response('Not found', { status: 404 });

    const page = await chatRepository.findOwnedPaginatedMessages(user.id, sessionId, { cursor, limit });
    if (!page) return new Response('Not found', { status: 404 });
    const { messages, hasMore, nextCursor } = page;

    return NextResponse.json({ session, messages, hasMore, nextCursor });
  } catch (error) {
    console.error('GET /api/ai/chat/sessions/[id] error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const fingerprint = getUserIdFromRequest(request);
    const user = await resolveUser(fingerprint);
    if (!user) return new Response('Unauthorized', { status: 401 });

    const { sessionId } = await params;
    const deleted = await chatRepository.deleteOwnedSession(user.id, sessionId);
    if (!deleted) return new Response('Not found', { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/ai/chat/sessions/[id] error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
