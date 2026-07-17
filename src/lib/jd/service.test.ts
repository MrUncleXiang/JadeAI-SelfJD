import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
});

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  resolveLlmConfig: vi.fn(),
  getModel: vi.fn(() => ({ modelId: 'jd-test-model' })),
}));

vi.mock('ai', () => ({ generateText: mocks.generateText }));
vi.mock('@/lib/llm/resolver', () => ({ resolveLlmConfig: mocks.resolveLlmConfig }));
vi.mock('@/lib/ai/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/provider')>();
  return {
    ...actual,
    getModel: mocks.getModel,
    getJsonProviderOptions: vi.fn(() => ({})),
  };
});

import type { ActorContext } from '@/lib/auth/service';
import { AIConfigError } from '@/lib/ai/provider';
import { db, dbReady } from '@/lib/db';
import { users } from '@/lib/db/schema';

import { jdService } from './service';

const suffix = crypto.randomUUID();
const userId = `jd-service-${suffix}`;

const actor: ActorContext = {
  userId,
  role: 'user',
  sessionId: `session-${suffix}`,
  requestId: `request-${suffix}`,
  user: {
    id: userId,
    username: userId,
    email: null,
    name: userId,
    avatarUrl: null,
    role: 'user',
    status: 'active',
    authType: 'password',
  },
};

beforeAll(async () => {
  await dbReady;
  await db.insert(users).values({ id: userId, username: userId, authType: 'password' });
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveLlmConfig.mockResolvedValue({
    provider: 'openai-compatible',
    apiKey: 'test-only',
    baseURL: 'https://llm.test/v1',
    model: 'jd-test-model',
  });
});

describe('JD extraction service', () => {
  it('uses the user JD profile and stores only reviewable, source-located requirements', async () => {
    const source = await jdService.createTextSource(actor, {
      text: `Senior Unity Engineer ${suffix}\nRequired skills\nC# and Unity`,
    });
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify({
        title: 'Senior Unity Engineer',
        company: '',
        jobTitle: 'Senior Unity Engineer',
        location: '',
        requirements: [{
          requirementType: 'hard_skill',
          text: 'C# and Unity',
          normalizedTerm: 'unity c#',
          aliases: ['C Sharp'],
          priority: 'required',
          importance: 1,
          sourceText: 'C# and Unity',
        }],
      }),
    });

    const extracted = await jdService.extractSource(actor, source.source.id);
    expect(mocks.resolveLlmConfig).toHaveBeenCalledWith(userId, 'jd');
    expect(mocks.generateText).toHaveBeenCalledWith(expect.objectContaining({
      system: expect.stringContaining('untrusted data'),
      prompt: expect.stringContaining('<job_description>'),
    }));
    expect(extracted).toMatchObject({ status: 'needs_review', parserId: 'llm-jd-extractor' });
    expect(extracted.requirements).toEqual([
      expect.objectContaining({
        text: 'C# and Unity',
        sourceLocator: expect.objectContaining({ line: 3 }),
      }),
    ]);
  });

  it('preserves the source and records a stable failure code when no JD LLM is bound', async () => {
    const source = await jdService.createTextSource(actor, {
      text: `Product engineer ${suffix}\nOwn product delivery`,
    });
    mocks.resolveLlmConfig.mockRejectedValueOnce(new AIConfigError(
      'LLM_PROFILE_REQUIRED',
      'Configure a JD profile.',
      422,
    ));

    await expect(jdService.extractSource(actor, source.source.id)).rejects.toMatchObject({
      code: 'LLM_PROFILE_REQUIRED',
      status: 422,
    });
    await expect(jdService.getSource(actor, source.source.id)).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'LLM_PROFILE_REQUIRED',
      normalizedText: expect.stringContaining('Own product delivery'),
    });
    expect(mocks.generateText).not.toHaveBeenCalled();
  });
});
