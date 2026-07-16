import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveUser: vi.fn(),
  findOwnedSession: vi.fn(),
  findOwnedRound: vi.fn(),
  findOwnedById: vi.fn(),
  addOwnedMessage: vi.fn(),
  updateOwnedRoundStatus: vi.fn(),
  updateOwnedSessionStatus: vi.fn(),
  resolveLlmConfig: vi.fn(),
  getModel: vi.fn(),
  convertToModelMessages: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ dbReady: Promise.resolve() }));

vi.mock('@/lib/auth/helpers', () => ({
  getUserIdFromRequest: vi.fn(() => null),
  resolveUser: mocks.resolveUser,
}));

vi.mock('@/lib/db/repositories/interview.repository', () => ({
  interviewRepository: {
    findOwnedSession: mocks.findOwnedSession,
    findOwnedRound: mocks.findOwnedRound,
    addOwnedMessage: mocks.addOwnedMessage,
    updateOwnedRoundStatus: mocks.updateOwnedRoundStatus,
    updateOwnedSessionStatus: mocks.updateOwnedSessionStatus,
  },
}));

vi.mock('@/lib/db/repositories/resume.repository', () => ({
  resumeRepository: { findOwnedById: mocks.findOwnedById },
}));

vi.mock('@/lib/ai/provider', () => {
  class AIConfigError extends Error {}
  return {
    AIConfigError,
    getModel: mocks.getModel,
  };
});

vi.mock('@/lib/llm/resolver', () => ({
  resolveLlmConfig: mocks.resolveLlmConfig,
}));

vi.mock('@/lib/ai/interview-prompts', () => ({
  buildInterviewSystemPrompt: vi.fn(() => 'system'),
}));

vi.mock('ai', () => ({
  convertToModelMessages: mocks.convertToModelMessages,
  streamText: mocks.streamText,
}));

import { POST } from './route';

function request(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost/api/interview/session-b/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

describe('POST /api/interview/[id]/chat tenant boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveUser.mockResolvedValue({ id: 'user-a' });
  });

  it('rejects another tenant session before parsing chat input or calling the LLM', async () => {
    mocks.findOwnedSession.mockResolvedValue(null);

    const response = await POST(request({}), {
      params: Promise.resolve({ id: 'session-b' }),
    });

    expect(response.status).toBe(404);
    expect(mocks.findOwnedSession).toHaveBeenCalledWith('user-a', 'session-b');
    expect(mocks.findOwnedRound).not.toHaveBeenCalled();
    expect(mocks.resolveLlmConfig).not.toHaveBeenCalled();
    expect(mocks.streamText).not.toHaveBeenCalled();
    expect(mocks.addOwnedMessage).not.toHaveBeenCalled();
  });

  it('rejects a round substituted from another session before any side effect', async () => {
    mocks.findOwnedSession.mockResolvedValue({
      id: 'session-a',
      userId: 'user-a',
      resumeId: null,
      jobDescription: 'JD',
    });
    mocks.findOwnedRound.mockResolvedValue(null);

    const response = await POST(request({
      messages: [],
      roundId: 'round-b',
    }), {
      params: Promise.resolve({ id: 'session-a' }),
    });

    expect(response.status).toBe(404);
    expect(mocks.findOwnedRound).toHaveBeenCalledWith('user-a', 'session-a', 'round-b');
    expect(mocks.resolveLlmConfig).not.toHaveBeenCalled();
    expect(mocks.streamText).not.toHaveBeenCalled();
    expect(mocks.addOwnedMessage).not.toHaveBeenCalled();
    expect(mocks.updateOwnedRoundStatus).not.toHaveBeenCalled();
    expect(mocks.updateOwnedSessionStatus).not.toHaveBeenCalled();
  });
});
