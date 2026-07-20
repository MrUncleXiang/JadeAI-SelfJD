import type { AIConfig } from '@/lib/ai/provider';
import { AIConfigError } from '@/lib/ai/provider';
import { dbReady } from '@/lib/db';
import {
  llmProfileRepository,
  type LlmFeature,
} from '@/lib/db/repositories/llm-profile.repository';

import { decryptLlmApiKey, LlmEncryptionError } from './encryption';
import { LlmBaseUrlPolicyError, validateLlmBaseUrl } from './outbound-url';
import { createLlmProviderFetch } from './transport';

type ProfileRecord = NonNullable<Awaited<ReturnType<typeof llmProfileRepository.findOwnedById>>>;
const DEFAULT_VISION_REQUEST_TIMEOUT_MS = 180_000;
const DEFAULT_RESUME_REQUEST_TIMEOUT_MS = 180_000;

function parseCapabilities(value: unknown): AIConfig['capabilities'] {
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return {}; }
  }
  if (!parsed || typeof parsed !== 'object') return {};
  const record = parsed as Record<string, unknown>;
  return {
    reachable: record.reachable === true,
    json: record.json === true,
    tools: record.tools === true,
    vision: record.vision === true,
  };
}

function resolverError(error: unknown): never {
  if (error instanceof AIConfigError) throw error;
  if (error instanceof LlmEncryptionError) {
    throw new AIConfigError(
      'LLM_PROFILE_DECRYPTION_FAILED',
      'The selected LLM profile secret cannot be decrypted by this deployment.',
      503,
    );
  }
  if (error instanceof LlmBaseUrlPolicyError) {
    const dnsFailure = error.code === 'BASE_URL_DNS_FAILED';
    throw new AIConfigError(
      dnsFailure ? 'LLM_BASE_URL_DNS_FAILED' : 'LLM_BASE_URL_BLOCKED',
      dnsFailure
        ? 'The selected LLM BaseURL could not be resolved safely.'
        : 'The selected LLM BaseURL is blocked by the outbound network policy.',
      422,
    );
  }
  throw error;
}

async function materializeProfile(
  userId: string,
  profile: ProfileRecord,
  options: { allowInvalid?: boolean; requestTimeoutMs?: number } = {},
): Promise<AIConfig> {
  if (profile.status === 'disabled') {
    throw new AIConfigError(
      'LLM_PROFILE_DISABLED',
      'The selected LLM profile is disabled.',
      409,
    );
  }
  if (profile.status === 'invalid' && !options.allowInvalid) {
    throw new AIConfigError(
      'LLM_PROFILE_INVALID',
      'The selected LLM profile failed its latest capability test.',
      422,
    );
  }

  try {
    const baseURL = await validateLlmBaseUrl(profile.baseUrl);
    const apiKey = decryptLlmApiKey({
      ciphertext: profile.encryptedApiKey,
      iv: profile.keyIv,
      tag: profile.keyTag,
      keyVersion: profile.keyVersion,
    }, { userId, profileId: profile.id });

    if (!apiKey) {
      throw new AIConfigError(
        'LLM_API_KEY_MISSING',
        'The selected LLM profile does not have an API key.',
        422,
      );
    }

    return {
      provider: profile.provider,
      wireApi: profile.provider === 'openai-compatible' && profile.wireApi === 'responses'
        ? 'responses'
        : 'chat-completions',
      apiKey,
      baseURL,
      model: profile.modelName,
      profileId: profile.id,
      capabilities: parseCapabilities(profile.capabilities),
      fetch: createLlmProviderFetch(baseURL, { timeoutMs: options.requestTimeoutMs }),
    };
  } catch (error) {
    resolverError(error);
  }
}

export async function resolveLlmConfig(
  userId: string,
  feature: LlmFeature,
): Promise<AIConfig> {
  await dbReady;
  const profile = await llmProfileRepository.findBoundProfileOwned(userId, feature);
  if (!profile) {
    throw new AIConfigError(
      'LLM_PROFILE_REQUIRED',
      `No LLM profile is bound to the ${feature} feature. Configure one in Settings.`,
      422,
    );
  }
  const configuredVisionTimeout = Number(process.env.LLM_VISION_REQUEST_TIMEOUT_MS);
  const configuredResumeTimeout = Number(process.env.LLM_RESUME_REQUEST_TIMEOUT_MS);
  return materializeProfile(userId, profile, {
    requestTimeoutMs: feature === 'vision'
      ? (Number.isFinite(configuredVisionTimeout)
          ? configuredVisionTimeout
          : DEFAULT_VISION_REQUEST_TIMEOUT_MS)
      : feature === 'resume'
        ? (Number.isFinite(configuredResumeTimeout)
            ? configuredResumeTimeout
            : DEFAULT_RESUME_REQUEST_TIMEOUT_MS)
      : undefined,
  });
}

export async function resolveOwnedLlmConfig(
  userId: string,
  profileId: string,
  options: { allowInvalid?: boolean } = {},
): Promise<AIConfig> {
  await dbReady;
  const profile = await llmProfileRepository.findOwnedById(userId, profileId);
  if (!profile) {
    throw new AIConfigError(
      'LLM_PROFILE_NOT_FOUND',
      'LLM profile not found.',
      404,
    );
  }
  return materializeProfile(userId, profile, options);
}
