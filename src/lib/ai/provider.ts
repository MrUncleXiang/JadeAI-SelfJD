import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

export interface AIConfig {
  provider: 'openai-compatible' | 'anthropic' | 'gemini';
  apiKey: string;
  baseURL: string;
  model: string;
  profileId?: string;
  capabilities?: {
    reachable?: boolean;
    json?: boolean;
    tools?: boolean;
    vision?: boolean;
  };
  fetch?: typeof globalThis.fetch;
}

export function getModel(config: AIConfig) {
  if (!config.apiKey) {
    throw new AIConfigError(
      'LLM_API_KEY_MISSING',
      'The selected LLM profile does not have an API key.',
      422,
    );
  }
  const modelId = config.model;

  switch (config.provider) {
    case 'anthropic': {
      const p = createAnthropic({
        apiKey: config.apiKey,
        baseURL: config.baseURL || undefined,
        fetch: config.fetch,
      });
      return p(modelId);
    }
    case 'gemini': {
      const p = createGoogleGenerativeAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL || undefined,
        fetch: config.fetch,
      });
      return p(modelId);
    }
    default: {
      const p = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        fetch: config.fetch,
      });
      return p.chat(modelId);
    }
  }
}

/**
 * Returns providerOptions for JSON mode — only applicable to OpenAI-compatible providers.
 */
export function getJsonProviderOptions(config: AIConfig) {
  if (config.provider === 'openai-compatible') {
    return { openai: { response_format: { type: 'json_object' as const } } };
  }
  return {} as Record<string, never>;
}

export class AIConfigError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 422,
  ) {
    super(message);
    this.name = 'AIConfigError';
  }
}
