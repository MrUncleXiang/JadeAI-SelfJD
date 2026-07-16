import { NextRequest } from 'next/server';
import { streamText, convertToModelMessages } from 'ai';
import { getModel, AIConfigError } from '@/lib/ai/provider';
import { resolveLlmConfig } from '@/lib/llm/resolver';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { interviewRepository } from '@/lib/db/repositories/interview.repository';
import { resumeRepository } from '@/lib/db/repositories/resume.repository';
import { buildInterviewSystemPrompt } from '@/lib/ai/interview-prompts';
import { dbReady } from '@/lib/db';
import type { InterviewerConfig } from '@/types/interview';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbReady;
    const { id: sessionId } = await params;
    const fingerprint = getUserIdFromRequest(request);
    const user = await resolveUser(fingerprint);
    if (!user) return new Response('Unauthorized', { status: 401 });

    const session = await interviewRepository.findOwnedSession(user.id, sessionId);
    if (!session) {
      return new Response('Not found', { status: 404 });
    }

    const { messages, roundId, locale = 'zh' } = await request.json();

    const round = await interviewRepository.findOwnedRound(user.id, sessionId, roundId);
    if (!round) {
      return new Response('Round not found', { status: 404 });
    }

    let resumeContent: string | undefined;
    if (session.resumeId) {
      const resume = await resumeRepository.findOwnedById(user.id, session.resumeId as string);
      if (resume) {
        resumeContent = JSON.stringify(resume.sections);
      }
    }

    const interviewerConfig = round.interviewerConfig as InterviewerConfig;

    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === 'user') {
        const textPart = lastMessage.parts?.find((p: { type: string }) => p.type === 'text');
        const content = textPart?.text || lastMessage.content || '';
        if (content) {
          await interviewRepository.addOwnedMessage(user.id, sessionId, {
            roundId,
            role: 'candidate',
            content,
          });
        }
      }
    }

    const aiConfig = await resolveLlmConfig(user.id, 'interview');
    const model = getModel(aiConfig);
    const modelMessages = await convertToModelMessages(messages);

    if (round.status === 'pending') {
      await interviewRepository.updateOwnedRoundStatus(user.id, sessionId, roundId, 'in_progress');
      await interviewRepository.updateOwnedSessionStatus(user.id, sessionId, 'in_progress');
    }

    const systemPrompt = buildInterviewSystemPrompt({
      interviewer: interviewerConfig,
      jobDescription: session.jobDescription,
      resumeContent,
      maxQuestions: round.maxQuestions,
      locale,
    });

    const result = streamText({
      model,
      system: systemPrompt,
      messages: modelMessages,
      onFinish: async ({ text }) => {
        if (!text) return;

        await interviewRepository.addOwnedMessage(user.id, sessionId, {
          roundId,
          role: 'interviewer',
          content: text,
        });

        await interviewRepository.incrementOwnedQuestionCount(user.id, sessionId, roundId);

        if (text.includes('[ROUND_COMPLETE]')) {
          await interviewRepository.updateOwnedRoundStatus(user.id, sessionId, roundId, 'completed');
          await interviewRepository.setOwnedRoundSummary(user.id, sessionId, roundId, {
            score: 0,
            feedback: text.replace('[ROUND_COMPLETE]', '').trim(),
          });

          const rounds = await interviewRepository.findOwnedRoundsBySessionId(user.id, sessionId) ?? [];
          const currentIndex = rounds.findIndex((r: { id: string }) => r.id === roundId);
          const nextRound = rounds[currentIndex + 1];

          if (nextRound) {
            await interviewRepository.updateOwnedSessionRound(user.id, sessionId, currentIndex + 1);
          } else {
            await interviewRepository.updateOwnedSessionStatus(user.id, sessionId, 'completed');
          }
        }
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    if (error instanceof AIConfigError) {
      return new Response(JSON.stringify({ code: error.code, error: error.message }), { status: error.status });
    }
    console.error('POST /api/interview/[id]/chat error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
