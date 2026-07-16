import { NextRequest, NextResponse } from 'next/server';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { interviewRepository } from '@/lib/db/repositories/interview.repository';
import { dbReady } from '@/lib/db';
import { interviewRounds } from '@/lib/db/schema';

type InterviewRoundRow = typeof interviewRounds.$inferSelect;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await dbReady;
  const { id } = await params;
  const fingerprint = getUserIdFromRequest(request);
  const user = await resolveUser(fingerprint);
  if (!user) return new Response('Unauthorized', { status: 401 });

  const session = await interviewRepository.findOwnedSession(user.id, id);
  if (!session) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const rounds = await interviewRepository.findOwnedRoundsBySessionId(user.id, id) ?? [];
  const report = await interviewRepository.findOwnedReportBySessionId(user.id, id);

  // Include messages for each round (needed for resume/history)
  const roundsWithMessages = await Promise.all(
    rounds.map(async (round: InterviewRoundRow) => {
      const messages = await interviewRepository.findOwnedMessagesByRoundId(user.id, id, round.id);
      return { ...round, messages: messages ?? [] };
    })
  );

  return NextResponse.json({ session, rounds: roundsWithMessages, report });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await dbReady;
  const { id } = await params;
  const fingerprint = getUserIdFromRequest(request);
  const user = await resolveUser(fingerprint);
  if (!user) return new Response('Unauthorized', { status: 401 });

  const session = await interviewRepository.findOwnedSession(user.id, id);
  if (!session) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { status } = await request.json();
  if (status) {
    await interviewRepository.updateOwnedSessionStatus(user.id, id, status);
  }

  const updated = await interviewRepository.findOwnedSession(user.id, id);
  return NextResponse.json(updated);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await dbReady;
  const { id } = await params;
  const fingerprint = getUserIdFromRequest(request);
  const user = await resolveUser(fingerprint);
  if (!user) return new Response('Unauthorized', { status: 401 });

  const deleted = await interviewRepository.deleteOwnedSession(user.id, id);
  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return new Response(null, { status: 204 });
}
