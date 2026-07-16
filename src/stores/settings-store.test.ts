import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearLegacyLlmConfigs, readLegacyLlmConfigs } from './settings-store';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
    clear: vi.fn(() => values.clear()),
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
    get length() { return values.size; },
  } satisfies Storage;
}

describe('legacy browser LLM migration helpers', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = memoryStorage();
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps old provider caches and standalone keys into new profile inputs', () => {
    storage.setItem('jade_provider_configs', JSON.stringify({
      openai: {
        baseURL: 'https://8.8.8.8/v1',
        model: 'custom-model',
        apiKey: 'cached-key',
      },
    }));
    storage.setItem('jade_api_key', 'cached-key');
    storage.setItem('jade_nanobanana_api_key', 'image-key');

    expect(readLegacyLlmConfigs()).toEqual([
      {
        provider: 'openai-compatible',
        baseUrl: 'https://8.8.8.8/v1',
        modelName: 'custom-model',
        apiKey: 'cached-key',
      },
      {
        provider: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        modelName: 'gemini-3.1-flash-image-preview',
        apiKey: 'image-key',
      },
    ]);
  });

  it('uses persisted non-secret server settings for an old standalone key', () => {
    storage.setItem('jade_api_key', 'standalone-key');

    expect(readLegacyLlmConfigs({
      provider: 'anthropic',
      baseUrl: 'https://8.8.4.4/v1',
      modelName: 'claude-custom',
    })).toEqual([{
      provider: 'anthropic',
      baseUrl: 'https://8.8.4.4/v1',
      modelName: 'claude-custom',
      apiKey: 'standalone-key',
    }]);
  });

  it('clears every known legacy secret only when explicitly requested', () => {
    storage.setItem('jade_api_key', 'one');
    storage.setItem('jade_provider_configs', 'two');
    storage.setItem('jade_nanobanana_api_key', 'three');

    clearLegacyLlmConfigs();

    expect(storage.getItem('jade_api_key')).toBeNull();
    expect(storage.getItem('jade_provider_configs')).toBeNull();
    expect(storage.getItem('jade_nanobanana_api_key')).toBeNull();
  });
});
