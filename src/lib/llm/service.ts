import { dbReady } from '@/lib/db';
import {
  llmProfileRepository,
  type LlmFeature,
  type LlmProvider,
} from '@/lib/db/repositories/llm-profile.repository';
import { authRepository } from '@/lib/db/repositories/auth.repository';
import type { ActorContext } from '@/lib/auth/service';

import { encryptLlmApiKey, LlmEncryptionError } from './encryption';
import { LlmBaseUrlPolicyError, validateLlmBaseUrl } from './outbound-url';

export const LLM_FEATURES: LlmFeature[] = ['resume', 'jd', 'vision', 'interview'];

export type LlmCapabilities = {
  reachable: boolean;
  json: boolean;
  tools: boolean;
  vision: boolean;
};

export type CreateLlmProfileInput = {
  name: string;
  provider: LlmProvider;
  baseUrl: string;
  modelName: string;
  apiKey: string;
};

export type UpdateLlmProfileInput = Partial<CreateLlmProfileInput>;

export class LlmProfileServiceError extends Error {
  constructor(
    public readonly code:
      | 'PROFILE_NOT_FOUND'
      | 'INVALID_BASE_URL'
      | 'BASE_URL_BLOCKED'
      | 'BASE_URL_DNS_FAILED'
      | 'LLM_ENCRYPTION_UNAVAILABLE',
    public readonly status: number,
  ) {
    super(code);
    this.name = 'LlmProfileServiceError';
  }
}

const EMPTY_CAPABILITIES: LlmCapabilities = {
  reachable: false,
  json: false,
  tools: false,
  vision: false,
};

function serviceError(error: unknown): never {
  if (error instanceof LlmBaseUrlPolicyError) {
    if (error.code === 'INVALID_BASE_URL') {
      throw new LlmProfileServiceError('INVALID_BASE_URL', 400);
    }
    if (error.code === 'BASE_URL_DNS_FAILED') {
      throw new LlmProfileServiceError('BASE_URL_DNS_FAILED', 422);
    }
    throw new LlmProfileServiceError('BASE_URL_BLOCKED', 422);
  }
  if (error instanceof LlmEncryptionError) {
    throw new LlmProfileServiceError('LLM_ENCRYPTION_UNAVAILABLE', 503);
  }
  throw error;
}

async function writeAudit(
  actor: ActorContext,
  action: string,
  profileId: string | null,
  metadata: Record<string, unknown> = {},
) {
  await authRepository.writeAudit({
    actorUserId: actor.userId,
    action,
    targetType: 'llm_profile',
    targetId: profileId,
    outcome: 'success',
    requestId: actor.requestId,
    metadata,
  });
}

export const llmProfileService = {
  async listProfiles(actor: ActorContext) {
    await dbReady;
    return llmProfileRepository.findAllOwned(actor.userId);
  },

  async createProfile(actor: ActorContext, input: CreateLlmProfileInput) {
    await dbReady;
    const profileId = crypto.randomUUID();
    try {
      const baseUrl = await validateLlmBaseUrl(input.baseUrl);
      const encrypted = encryptLlmApiKey(input.apiKey, { userId: actor.userId, profileId });
      const profile = await llmProfileRepository.createOwned(actor.userId, {
        id: profileId,
        name: input.name,
        provider: input.provider,
        baseUrl,
        modelName: input.modelName,
        encryptedApiKey: encrypted.ciphertext,
        keyIv: encrypted.iv,
        keyTag: encrypted.tag,
        keyVersion: encrypted.keyVersion,
        capabilities: EMPTY_CAPABILITIES,
      });
      await writeAudit(actor, 'llm_profile.created', profileId, {
        provider: input.provider,
        modelName: input.modelName,
      });
      return profile!;
    } catch (error) {
      serviceError(error);
    }
  },

  async updateProfile(actor: ActorContext, profileId: string, input: UpdateLlmProfileInput) {
    await dbReady;
    const existing = await llmProfileRepository.findOwnedById(actor.userId, profileId);
    if (!existing) throw new LlmProfileServiceError('PROFILE_NOT_FOUND', 404);

    try {
      const changes: Parameters<typeof llmProfileRepository.updateOwned>[2] = {};
      if (input.name !== undefined) changes.name = input.name;
      if (input.provider !== undefined) changes.provider = input.provider;
      if (input.modelName !== undefined) changes.modelName = input.modelName;
      if (input.baseUrl !== undefined) changes.baseUrl = await validateLlmBaseUrl(input.baseUrl);
      if (input.apiKey !== undefined) {
        const encrypted = encryptLlmApiKey(input.apiKey, { userId: actor.userId, profileId });
        changes.encryptedApiKey = encrypted.ciphertext;
        changes.keyIv = encrypted.iv;
        changes.keyTag = encrypted.tag;
        changes.keyVersion = encrypted.keyVersion;
      }

      const invalidatesProbe = input.provider !== undefined
        || input.modelName !== undefined
        || input.baseUrl !== undefined
        || input.apiKey !== undefined;
      if (invalidatesProbe) {
        changes.capabilities = EMPTY_CAPABILITIES;
        changes.status = 'untested';
        changes.lastTestedAt = null;
      }

      const profile = await llmProfileRepository.updateOwned(actor.userId, profileId, changes);
      await writeAudit(actor, 'llm_profile.updated', profileId, {
        changedFields: Object.keys(input),
      });
      return profile!;
    } catch (error) {
      serviceError(error);
    }
  },

  async deleteProfile(actor: ActorContext, profileId: string) {
    await dbReady;
    const deleted = await llmProfileRepository.deleteOwned(actor.userId, profileId);
    if (!deleted) throw new LlmProfileServiceError('PROFILE_NOT_FOUND', 404);
    await writeAudit(actor, 'llm_profile.deleted', profileId);
  },

  async listBindings(actor: ActorContext) {
    await dbReady;
    const rows = await llmProfileRepository.findBindingsOwned(actor.userId);
    const bindings: Record<LlmFeature, string | null> = {
      resume: null,
      jd: null,
      vision: null,
      interview: null,
    };
    for (const row of rows) bindings[row.feature as LlmFeature] = row.llmProfileId;
    return bindings;
  },

  async setBinding(actor: ActorContext, feature: LlmFeature, profileId: string | null) {
    await dbReady;
    const binding = await llmProfileRepository.setBindingOwned(actor.userId, feature, profileId);
    if (!binding) throw new LlmProfileServiceError('PROFILE_NOT_FOUND', 404);
    await authRepository.writeAudit({
      actorUserId: actor.userId,
      action: 'llm_binding.updated',
      targetType: 'llm_feature_binding',
      targetId: feature,
      outcome: 'success',
      requestId: actor.requestId,
      metadata: { profileId },
    });
    return binding;
  },
};
