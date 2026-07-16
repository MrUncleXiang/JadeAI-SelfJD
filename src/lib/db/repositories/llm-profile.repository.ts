import { and, desc, eq } from 'drizzle-orm';

import { db } from '../index';
import { llmFeatureBindings, llmProfiles } from '../schema';

export type LlmFeature = 'resume' | 'jd' | 'vision' | 'interview';
export type LlmProvider = 'openai-compatible' | 'anthropic' | 'gemini';
export type LlmProfileStatus = 'active' | 'invalid' | 'disabled' | 'untested';

type EncryptedKeyColumns = {
  encryptedApiKey: string;
  keyIv: string;
  keyTag: string;
  keyVersion: number;
};

type CreateProfileInput = EncryptedKeyColumns & {
  id: string;
  name: string;
  provider: LlmProvider;
  baseUrl: string;
  modelName: string;
  capabilities: unknown;
  status?: LlmProfileStatus;
};

type UpdateProfileInput = Partial<EncryptedKeyColumns & {
  name: string;
  provider: LlmProvider;
  baseUrl: string;
  modelName: string;
  capabilities: unknown;
  status: LlmProfileStatus;
  lastTestedAt: Date | null;
}>;

export const llmProfileRepository = {
  async findAllOwned(userId: string) {
    return db
      .select()
      .from(llmProfiles)
      .where(eq(llmProfiles.userId, userId))
      .orderBy(desc(llmProfiles.updatedAt));
  },

  async findOwnedById(userId: string, profileId: string) {
    const rows = await db
      .select()
      .from(llmProfiles)
      .where(and(eq(llmProfiles.id, profileId), eq(llmProfiles.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  },

  async createOwned(userId: string, input: CreateProfileInput) {
    await db.insert(llmProfiles).values({
      ...input,
      userId,
      status: input.status || 'untested',
    });
    return this.findOwnedById(userId, input.id);
  },

  async updateOwned(userId: string, profileId: string, input: UpdateProfileInput) {
    await db
      .update(llmProfiles)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(llmProfiles.id, profileId), eq(llmProfiles.userId, userId)));
    return this.findOwnedById(userId, profileId);
  },

  async deleteOwned(userId: string, profileId: string) {
    const existing = await this.findOwnedById(userId, profileId);
    if (!existing) return false;
    await db
      .delete(llmProfiles)
      .where(and(eq(llmProfiles.id, profileId), eq(llmProfiles.userId, userId)));
    return true;
  },

  async findBindingsOwned(userId: string) {
    return db
      .select()
      .from(llmFeatureBindings)
      .where(eq(llmFeatureBindings.userId, userId));
  },

  async setBindingOwned(userId: string, feature: LlmFeature, profileId: string | null) {
    if (!profileId) {
      await db
        .delete(llmFeatureBindings)
        .where(and(
          eq(llmFeatureBindings.userId, userId),
          eq(llmFeatureBindings.feature, feature),
        ));
      return { feature, profileId: null };
    }

    const profile = await this.findOwnedById(userId, profileId);
    if (!profile) return null;

    await db
      .insert(llmFeatureBindings)
      .values({
        id: crypto.randomUUID(),
        userId,
        feature,
        llmProfileId: profileId,
      })
      .onConflictDoUpdate({
        target: [llmFeatureBindings.userId, llmFeatureBindings.feature],
        set: { llmProfileId: profileId, updatedAt: new Date() },
      });
    return { feature, profileId };
  },

  async findBoundProfileOwned(userId: string, feature: LlmFeature) {
    const rows = await db
      .select({ profile: llmProfiles })
      .from(llmFeatureBindings)
      .innerJoin(llmProfiles, and(
        eq(llmFeatureBindings.llmProfileId, llmProfiles.id),
        eq(llmProfiles.userId, userId),
      ))
      .where(and(
        eq(llmFeatureBindings.userId, userId),
        eq(llmFeatureBindings.feature, feature),
      ))
      .limit(1);
    return rows[0]?.profile ?? null;
  },
};
