import { describe, expect, it } from 'vitest';

import { getJsonProviderOptions, getModel } from './provider';

const base = {
  provider: 'openai-compatible' as const,
  apiKey: 'test-only',
  baseURL: 'https://llm.test/v1',
  model: 'vision-model',
};

describe('AI provider wire protocol', () => {
  it('keeps Chat Completions as the backwards-compatible default', () => {
    expect(getModel(base)).toMatchObject({ provider: 'openai.chat' });
    expect(getJsonProviderOptions(base)).toEqual({
      openai: { response_format: { type: 'json_object' } },
    });
  });

  it('selects the Responses API for Codex-compatible gateways', () => {
    const config = { ...base, wireApi: 'responses' as const };
    expect(getModel(config)).toMatchObject({ provider: 'openai.responses' });
    expect(getJsonProviderOptions(config)).toEqual({});
  });
});
