import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveUser: vi.fn(),
  findOwnedById: vi.fn(),
  findOwnedSession: vi.fn(),
  updateOwnedSessionTitle: vi.fn(),
  addOwnedMessage: vi.fn(),
  extractAIConfig: vi.fn(),
  getModel: vi.fn(),
  convertToModelMessages: vi.fn(),
  createExecutableTools: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock('@/lib/auth/helpers', () => ({
  getUserIdFromRequest: vi.fn(() => null),
  resolveUser: mocks.resolveUser,
}));

vi.mock('@/lib/db/repositories/resume.repository', () => ({
  resumeRepository: {
    findOwnedById: mocks.findOwnedById,
  },
}));

vi.mock('@/lib/db/repositories/chat.repository', () => ({
  chatRepository: {
    findOwnedSession: mocks.findOwnedSession,
    updateOwnedSessionTitle: mocks.updateOwnedSessionTitle,
    addOwnedMessage: mocks.addOwnedMessage,
  },
}));

vi.mock('@/lib/ai/provider', () => {
  class AIConfigError extends Error {}
  return {
    AIConfigError,
    extractAIConfig: mocks.extractAIConfig,
    getModel: mocks.getModel,
  };
});

vi.mock('@/lib/ai/prompts', () => ({
  getSystemPrompt: vi.fn(() => 'system'),
}));

vi.mock('@/lib/ai/tools', () => ({
  createExecutableTools: mocks.createExecutableTools,
}));

vi.mock('ai', () => ({
  convertToModelMessages: mocks.convertToModelMessages,
  stepCountIs: vi.fn(() => 'stop-condition'),
  streamText: mocks.streamText,
}));

import { POST } from './route';

function request(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost/api/ai/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

const userMessage = {
  role: 'user',
  parts: [{ type: 'text', text: 'Improve my resume' }],
};

describe('POST /api/ai/chat tenant boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveUser.mockResolvedValue({ id: 'user-a' });
    mocks.extractAIConfig.mockReturnValue({ provider: 'test' });
    mocks.getModel.mockReturnValue({ id: 'model' });
    mocks.convertToModelMessages.mockResolvedValue([userMessage]);
    mocks.createExecutableTools.mockReturnValue({ updateSection: {} });
    mocks.streamText.mockReturnValue({
      toUIMessageStreamResponse: () => new Response('stream'),
    });
  });

  it('rejects a resume not owned by the actor before any LLM or chat side effect', async () => {
    mocks.findOwnedById.mockResolvedValue(null);

    const response = await POST(request({
      messages: [userMessage],
      resumeId: 'resume-b',
      sessionId: 'session-b',
    }));

    expect(response.status).toBe(404);
    expect(mocks.findOwnedById).toHaveBeenCalledWith('user-a', 'resume-b');
    expect(mocks.findOwnedSession).not.toHaveBeenCalled();
    expect(mocks.extractAIConfig).not.toHaveBeenCalled();
    expect(mocks.streamText).not.toHaveBeenCalled();
    expect(mocks.updateOwnedSessionTitle).not.toHaveBeenCalled();
    expect(mocks.addOwnedMessage).not.toHaveBeenCalled();
  });

  it('rejects a chat session not owned by the actor before any LLM call', async () => {
    mocks.findOwnedById.mockResolvedValue({
      id: 'resume-a',
      userId: 'user-a',
      sections: [],
    });
    mocks.findOwnedSession.mockResolvedValue(null);

    const response = await POST(request({
      messages: [userMessage],
      resumeId: 'resume-a',
      sessionId: 'session-b',
    }));

    expect(response.status).toBe(404);
    expect(mocks.findOwnedSession).toHaveBeenCalledWith('user-a', 'session-b');
    expect(mocks.extractAIConfig).not.toHaveBeenCalled();
    expect(mocks.streamText).not.toHaveBeenCalled();
    expect(mocks.addOwnedMessage).not.toHaveBeenCalled();
  });

  it('passes the actor identity through owned chat writes and executable tools', async () => {
    mocks.findOwnedById.mockResolvedValue({
      id: 'resume-a',
      userId: 'user-a',
      sections: [{ id: 'section-a', type: 'summary', content: { text: 'old' } }],
    });
    mocks.findOwnedSession.mockResolvedValue({
      id: 'session-a',
      resumeId: 'resume-a',
    });
    mocks.updateOwnedSessionTitle.mockResolvedValue(true);
    mocks.addOwnedMessage.mockResolvedValue({ id: 'message-a' });

    const response = await POST(request({
      messages: [userMessage],
      resumeId: 'resume-a',
      sessionId: 'session-a',
    }));

    expect(response.status).toBe(200);
    expect(mocks.updateOwnedSessionTitle).toHaveBeenCalledWith(
      'user-a',
      'session-a',
      'Improve my resume',
    );
    expect(mocks.addOwnedMessage).toHaveBeenCalledWith('user-a', {
      sessionId: 'session-a',
      role: 'user',
      content: 'Improve my resume',
    });
    expect(mocks.createExecutableTools).toHaveBeenCalledWith(
      'user-a',
      'resume-a',
      { provider: 'test' },
    );
    expect(mocks.streamText).toHaveBeenCalledOnce();
  });
});
