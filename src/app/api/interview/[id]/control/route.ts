import { NextRequest, NextResponse } from 'next/server';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { interviewRepository } from '@/lib/db/repositories/interview.repository';
import { buildHintPrompt, buildSkipPrompt } from '@/lib/ai/interview-prompts';
import { dbReady } from '@/lib/db';
import { interviewRounds } from '@/lib/db/schema';

type InterviewRoundRow = typeof interviewRounds.$inferSelect;

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

  const { action, roundId, locale = 'zh' } = await request.json();

  let systemMessage = '';
  switch (action) {
    case 'skip':
      systemMessage = buildSkipPrompt(locale);
      break;
    case 'hint':
      systemMessage = buildHintPrompt(locale);
      break;
    case 'end_round': {
      // Mark current round as completed
      if (roundId) {
        const updated = await interviewRepository.updateOwnedRoundStatus(
          user.id,
          sessionId,
          roundId,
          'completed',
        );
        if (!updated) return NextResponse.json({ error: 'Round not found' }, { status: 404 });
      }
      // Advance to next round or complete session
      const rounds = await interviewRepository.findOwnedRoundsBySessionId(user.id, sessionId) ?? [];
      const currentIndex = rounds.findIndex((round: InterviewRoundRow) => round.id === roundId);
      const nextRound = currentIndex >= 0 ? rounds[currentIndex + 1] : undefined;
      if (nextRound) {
        await interviewRepository.updateOwnedSessionRound(user.id, sessionId, currentIndex + 1);
      } else {
        await interviewRepository.updateOwnedSessionStatus(user.id, sessionId, 'completed');
      }
      return NextResponse.json({ success: true });
    }
    case 'pause':
      await interviewRepository.updateOwnedSessionStatus(user.id, sessionId, 'paused');
      return NextResponse.json({ success: true });
    case 'resume':
      await interviewRepository.updateOwnedSessionStatus(user.id, sessionId, 'in_progress');
      return NextResponse.json({ success: true });
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  if (systemMessage && roundId) {
    const message = await interviewRepository.addOwnedMessage(user.id, sessionId, {
      roundId,
      role: 'system',
      content: systemMessage,
    });
    if (!message) return NextResponse.json({ error: 'Round not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true, systemMessage });
}
