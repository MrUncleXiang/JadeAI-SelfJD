import { create } from 'zustand';

export type LlmProvider = 'openai-compatible' | 'anthropic' | 'gemini';
export type LlmFeature = 'resume' | 'jd' | 'vision' | 'interview';

export interface LlmProfileSummary {
  id: string;
  name: string;
  provider: LlmProvider;
  baseUrl: string;
  modelName: string;
  hasApiKey: boolean;
  status: 'active' | 'invalid' | 'disabled' | 'untested';
  capabilities: {
    reachable: boolean;
    json: boolean;
    tools: boolean;
    vision: boolean;
    errors?: Partial<Record<'reachable' | 'json' | 'tools' | 'vision', string>>;
    latencyMs?: number;
  };
  lastTestedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export type LlmBindings = Record<LlmFeature, string | null>;
export type LegacyLlmFallback = {
  provider?: unknown;
  baseUrl?: unknown;
  modelName?: unknown;
};

interface SettingsStore {
  autoSave: boolean;
  autoSaveInterval: number;
  llmProfiles: LlmProfileSummary[];
  llmBindings: LlmBindings;
  llmLoading: boolean;
  llmLoaded: boolean;
  llmError: string | null;
  legacyLlmFallback: LegacyLlmFallback;
  _hydrated: boolean;
  _syncing: boolean;
  setAutoSave: (enabled: boolean) => void;
  setAutoSaveInterval: (interval: number) => void;
  refreshLlm: () => Promise<void>;
  hydrate: () => Promise<void>;
}

export type LegacyLlmConfig = {
  provider: LlmProvider;
  baseUrl: string;
  modelName: string;
  apiKey: string;
};

const API_KEY_STORAGE_KEY = 'jade_api_key';
const PROVIDER_CONFIGS_KEY = 'jade_provider_configs';
const LEGACY_IMAGE_API_KEY_STORAGE_KEY = 'jade_nanobanana_api_key';

const EMPTY_BINDINGS: LlmBindings = {
  resume: null,
  jd: null,
  vision: null,
  interview: null,
};

function getFingerprint(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('jade_fingerprint');
}

function getHeaders(): Record<string, string> {
  const fingerprint = getFingerprint();
  return {
    'Content-Type': 'application/json',
    ...(fingerprint ? { 'x-fingerprint': fingerprint } : {}),
  };
}

function provider(value: unknown): LlmProvider {
  if (value === 'anthropic' || value === 'gemini') return value;
  return 'openai-compatible';
}

export function readLegacyLlmConfigs(fallback?: LegacyLlmFallback): LegacyLlmConfig[] {
  if (typeof window === 'undefined') return [];
  const results: LegacyLlmConfig[] = [];
  try {
    const raw = localStorage.getItem(PROVIDER_CONFIGS_KEY);
    const configs = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    for (const [rawProvider, rawConfig] of Object.entries(configs)) {
      if (!rawConfig || typeof rawConfig !== 'object') continue;
      const config = rawConfig as Record<string, unknown>;
      if (typeof config.apiKey !== 'string' || !config.apiKey.trim()) continue;
      results.push({
        provider: provider(rawProvider),
        baseUrl: typeof config.baseURL === 'string' ? config.baseURL : '',
        modelName: typeof config.model === 'string' ? config.model : '',
        apiKey: config.apiKey,
      });
    }

    const standaloneKey = localStorage.getItem(API_KEY_STORAGE_KEY);
    if (standaloneKey && !results.some((item) => item.apiKey === standaloneKey)) {
      results.push({
        provider: provider(fallback?.provider),
        baseUrl: typeof fallback?.baseUrl === 'string' ? fallback.baseUrl : 'https://api.openai.com/v1',
        modelName: typeof fallback?.modelName === 'string' ? fallback.modelName : 'gpt-4o',
        apiKey: standaloneKey,
      });
    }
    const imageKey = localStorage.getItem(LEGACY_IMAGE_API_KEY_STORAGE_KEY);
    if (imageKey && !results.some((item) => item.apiKey === imageKey)) {
      results.push({
        provider: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        modelName: 'gemini-3.1-flash-image-preview',
        apiKey: imageKey,
      });
    }
  } catch {
    return [];
  }
  return results.filter((item) => item.baseUrl && item.modelName);
}

export function clearLegacyLlmConfigs() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(API_KEY_STORAGE_KEY);
  localStorage.removeItem(PROVIDER_CONFIGS_KEY);
  localStorage.removeItem(LEGACY_IMAGE_API_KEY_STORAGE_KEY);
}

export function getBoundLlmProfile(
  feature: LlmFeature,
  state = useSettingsStore.getState(),
): LlmProfileSummary | null {
  const profileId = state.llmBindings[feature];
  return state.llmProfiles.find((profile) => profile.id === profileId) || null;
}

let syncTimeout: ReturnType<typeof setTimeout> | null = null;

function syncEditorSettings(state: SettingsStore) {
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(async () => {
    try {
      await fetch('/api/user/settings', {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({
          autoSave: state.autoSave,
          autoSaveInterval: state.autoSaveInterval,
        }),
      });
    } catch {
      // Local editor preferences remain usable if the sync fails.
    }
  }, 500);
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  autoSave: true,
  autoSaveInterval: 500,
  llmProfiles: [],
  llmBindings: { ...EMPTY_BINDINGS },
  llmLoading: false,
  llmLoaded: false,
  llmError: null,
  legacyLlmFallback: {},
  _hydrated: false,
  _syncing: false,

  setAutoSave: (enabled) => {
    set({ autoSave: enabled });
    syncEditorSettings(get());
  },

  setAutoSaveInterval: (interval) => {
    set({ autoSaveInterval: interval });
    syncEditorSettings(get());
  },

  refreshLlm: async () => {
    set({ llmLoading: true, llmError: null });
    try {
      const [profilesResponse, bindingsResponse] = await Promise.all([
        fetch('/api/llm-profiles', { headers: getHeaders(), cache: 'no-store' }),
        fetch('/api/llm-bindings', { headers: getHeaders(), cache: 'no-store' }),
      ]);
      if (!profilesResponse.ok || !bindingsResponse.ok) {
        throw new Error('LLM_PROFILE_LOAD_FAILED');
      }
      const [llmProfiles, llmBindings] = await Promise.all([
        profilesResponse.json() as Promise<LlmProfileSummary[]>,
        bindingsResponse.json() as Promise<LlmBindings>,
      ]);
      set({ llmProfiles, llmBindings, llmLoaded: true, llmLoading: false });
    } catch (error) {
      set({
        llmLoading: false,
        llmLoaded: true,
        llmError: error instanceof Error ? error.message : 'LLM_PROFILE_LOAD_FAILED',
      });
    }
  },

  hydrate: async () => {
    if (get()._hydrated || get()._syncing) return;
    set({ _syncing: true });
    try {
      const response = await fetch('/api/user/settings', { headers: getHeaders(), cache: 'no-store' });
      if (response.ok) {
        const data = await response.json();
        set({
          ...(typeof data.autoSave === 'boolean' ? { autoSave: data.autoSave } : {}),
          ...(typeof data.autoSaveInterval === 'number'
            ? { autoSaveInterval: data.autoSaveInterval }
            : {}),
          legacyLlmFallback: {
            provider: data.aiProvider,
            baseUrl: data.aiBaseURL,
            modelName: data.aiModel,
          },
        });
      }
    } catch {
      // Continue with local defaults.
    }
    await get().refreshLlm();
    set({ _hydrated: true, _syncing: false });
  },
}));

if (typeof window !== 'undefined') {
  void useSettingsStore.getState().hydrate();
}
