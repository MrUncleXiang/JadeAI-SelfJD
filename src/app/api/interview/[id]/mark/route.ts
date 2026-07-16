import { NextRequest, NextResponse } from 'next/server';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { interviewRepository } from '@/lib/db/repositories/interview.repository';
import { dbReady } from '@/lib/db';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await dbReady;
  const { id: sessionId } = await params;
  const fingerprint = getUserIdFromRequest(request);
  const user = await resolveUser(fingerprint);
  if (!user) return new Response('Unauthorized', { status: 401 });

  const session = await interviewRepository.findOwnedSession(user.id, sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { messageId, marked } = await request.json();
  const updated = await interviewRepository.updateOwnedMessageMetadata(
    user.id,
    sessionId,
    messageId,
    { marked },
  );
  if (!updated) return NextResponse.json({ error: 'Message not found' }, { status: 404 });

  return NextResponse.json({ success: true });
}
