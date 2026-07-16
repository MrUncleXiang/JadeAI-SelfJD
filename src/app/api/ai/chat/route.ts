import { NextRequest } from 'next/server';
import { streamText, convertToModelMessages } from 'ai';
import { getModel, AIConfigError } from '@/lib/ai/provider';
import { resolveLlmConfig } from '@/lib/llm/resolver';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { resumeRepository } from '@/lib/db/repositories/resume.repository';
import { chatRepository } from '@/lib/db/repositories/chat.repository';
import { getSystemPrompt } from '@/lib/ai/prompts';

const MAX_ROUNDS = 10;
const MAX_MESSAGES = MAX_ROUNDS * 2; // 10 rounds = 20 messages (user + assistant)

export async function POST(request: NextRequest) {
  try {
    const fingerprint = getUserIdFromRequest(request);
    const user = await resolveUser(fingerprint);
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const body = await request.json();
    const messages = body?.messages;
    const resumeId = typeof body?.resumeId === 'string' ? body.resumeId : undefined;
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : undefined;

    if (!Array.isArray(messages)) {
      return new Response('Invalid messages', { status: 400 });
    }

    let resumeContext = '';
    let effectiveResumeId = resumeId;
    if (resumeId) {
      const resume = await resumeRepository.findOwnedById(user.id, resumeId);
      if (!resume) return new Response('Not found', { status: 404 });
      resumeContext = JSON.stringify(resume.sections);
    }

    if (sessionId) {
      const session = await chatRepository.findOwnedSession(user.id, sessionId);
      if (!session) return new Response('Not found', { status: 404 });
      if (resumeId && session.resumeId !== resumeId) {
        return new Response('Not found', { status: 404 });
      }

      if (!effectiveResumeId) {
        effectiveResumeId = session.resumeId;
        const resume = await resumeRepository.findOwnedById(user.id, effectiveResumeId);
        if (!resume) return new Response('Not found', { status: 404 });
        resumeContext = JSON.stringify(resume.sections);
      }
    }

    // Save user message to DB before streaming
    if (sessionId && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === 'user') {
        const textPart = lastMessage.parts?.find((p: { type: string }) => p.type === 'text');
        const content = textPart?.text || lastMessage.content || '';
        if (content) {
          // First user message in this session → set as session title
          const userMessages = messages.filter((m: { role: string }) => m.role === 'user');
          if (userMessages.length === 1) {
            const title = content.slice(0, 50);
            await chatRepository.updateOwnedSessionTitle(user.id, sessionId, title);
          }

          await chatRepository.addOwnedMessage(user.id, {
            sessionId,
            role: 'user',
            content,
          });
        }
      }
    }

    const aiConfig = await resolveLlmConfig(user.id, 'resume');
    const model = getModel(aiConfig);
    const modelMessages = await convertToModelMessages(messages);

    // Truncate to last N rounds for LLM context
    const truncatedMessages = modelMessages.slice(-MAX_MESSAGES);

    const result = streamText({
      model,
      system: getSystemPrompt(resumeContext),
      messages: truncatedMessages,
      onFinish: async ({ text, steps }) => {
        if (!sessionId) return;

        // Preserve streamed text parts for the persisted assistant message.
        const orderedParts: { type: 'text'; text: string }[] = [];

        for (const step of steps) {
          if (step.text) {
            orderedParts.push({ type: 'text', text: step.text });
          }
        }

        const fullText = text || '';
        if (fullText) {
          await chatRepository.addOwnedMessage(user.id, {
            sessionId,
            role: 'assistant',
            content: fullText,
            metadata: orderedParts.length > 0 ? { orderedParts } : {},
          });
        }
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    if (error instanceof AIConfigError) {
      return new Response(JSON.stringify({ code: error.code, error: error.message }), { status: error.status });
    }
    console.error('POST /api/ai/chat error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
