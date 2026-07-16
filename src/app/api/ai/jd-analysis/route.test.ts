import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveUser: vi.fn(),
  findOwnedById: vi.fn(),
  createOwnedJdAnalysis: vi.fn(),
  resolveLlmConfig: vi.fn(),
  getModel: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock('@/lib/auth/helpers', () => ({
  getUserIdFromRequest: vi.fn(() => null),
  resolveUser: mocks.resolveUser,
}));

vi.mock('@/lib/db/repositories/resume.repository', () => ({
  resumeRepository: { findOwnedById: mocks.findOwnedById },
}));

vi.mock('@/lib/db/repositories/analysis.repository', () => ({
  analysisRepository: { createOwnedJdAnalysis: mocks.createOwnedJdAnalysis },
}));

vi.mock('@/lib/ai/provider', () => {
  class AIConfigError extends Error {}
  return {
    AIConfigError,
    getJsonProviderOptions: vi.fn(() => ({})),
    getModel: mocks.getModel,
  };
});

vi.mock('@/lib/llm/resolver', () => ({
  resolveLlmConfig: mocks.resolveLlmConfig,
}));

vi.mock('ai', () => ({ generateText: mocks.generateText }));

import { POST } from './route';

function request(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost/api/ai/jd-analysis', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

describe('POST /api/ai/jd-analysis tenant boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveUser.mockResolvedValue({ id: 'user-a' });
  });

  it('rejects another tenant resume before resolving a model or calling the LLM', async () => {
    mocks.findOwnedById.mockResolvedValue(null);

    const response = await POST(request({
      resumeId: 'resume-b',
      jobDescription: 'Senior engineer',
    }));

    expect(response.status).toBe(404);
    expect(mocks.findOwnedById).toHaveBeenCalledWith('user-a', 'resume-b');
    expect(mocks.resolveLlmConfig).not.toHaveBeenCalled();
    expect(mocks.getModel).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(mocks.createOwnedJdAnalysis).not.toHaveBeenCalled();
  });
});
