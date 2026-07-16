import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  getModel: vi.fn(() => ({ id: 'model' })),
}));

vi.mock('ai', () => ({
  generateText: mocks.generateText,
  tool: vi.fn((definition) => definition),
}));

vi.mock('@/lib/ai/provider', () => ({
  getModel: mocks.getModel,
  getJsonProviderOptions: vi.fn(() => ({})),
}));

import { classifyLlmProbeError, probeLlmCapabilities } from './probe';

const config = {
  provider: 'openai-compatible' as const,
  apiKey: 'server-only-key',
  baseURL: 'https://8.8.8.8/v1',
  model: 'test-model',
};

describe('LLM capability probe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects reachable, JSON, tool and vision support independently', async () => {
    mocks.generateText
      .mockResolvedValueOnce({ text: 'OK' })
      .mockResolvedValueOnce({ text: '{"ok":true}' })
      .mockResolvedValueOnce({ text: '', toolCalls: [{ toolName: 'capabilityProbe' }] })
      .mockResolvedValueOnce({ text: 'red' });

    const result = await probeLlmCapabilities(config);

    expect(result).toMatchObject({
      reachable: true,
      json: true,
      tools: true,
      vision: true,
      errors: {},
    });
    expect(mocks.generateText).toHaveBeenCalledTimes(4);
  });

  it('stops optional probes when connectivity/authentication fails', async () => {
    mocks.generateText.mockRejectedValueOnce(Object.assign(new Error('denied'), { statusCode: 401 }));

    const result = await probeLlmCapabilities(config);

    expect(result).toMatchObject({
      reachable: false,
      json: false,
      tools: false,
      vision: false,
      errors: { reachable: 'AUTH_FAILED' },
    });
    expect(mocks.generateText).toHaveBeenCalledOnce();
  });

  it('records stable capability error codes without exposing provider bodies', async () => {
    mocks.generateText
      .mockResolvedValueOnce({ text: 'OK' })
      .mockResolvedValueOnce({ text: 'not-json' })
      .mockRejectedValueOnce(new Error('tool calling is not supported'))
      .mockRejectedValueOnce(Object.assign(new Error('slow'), { status: 429 }));

    const result = await probeLlmCapabilities(config);

    expect(result.errors).toEqual({
      json: 'INVALID_RESPONSE',
      tools: 'UNSUPPORTED',
      vision: 'RATE_LIMITED',
    });
    expect(JSON.stringify(result)).not.toContain('tool calling is not supported');
    expect(classifyLlmProbeError(Object.assign(new Error('missing'), { status: 404 })))
      .toBe('MODEL_NOT_FOUND');
    expect(classifyLlmProbeError(new Error('provider-specific secret response')))
      .toBe('PROVIDER_ERROR');
  });
});
