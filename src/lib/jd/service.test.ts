import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

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

  it('uses only a probed Vision binding and stores an image result for human review', async () => {
    const buffer = await sharp({
      create: { width: 65, height: 65, channels: 3, background: '#fef3c7' },
    }).png().toBuffer();
    mocks.resolveLlmConfig.mockResolvedValueOnce({
      provider: 'openai-compatible',
      apiKey: 'test-only',
      baseURL: 'https://llm.test/v1',
      model: 'vision-test-model',
      capabilities: { vision: true },
    });
    mocks.generateText.mockResolvedValueOnce({
      text: JSON.stringify({
        normalizedText: `高级 Unity 工程师 ${suffix}\n要求：熟练使用 C# 与 Unity`,
        title: '高级 Unity 工程师',
        company: '',
        jobTitle: '高级 Unity 工程师',
        location: '',
        requirements: [{
          requirementType: 'hard_skill',
          text: '熟练使用 C# 与 Unity',
          normalizedTerm: 'unity c#',
          aliases: [],
          priority: 'required',
          importance: 1,
          sourceText: '熟练使用 C# 与 Unity',
        }],
      }),
    });

    const created = await jdService.createImageSource(actor, {
      buffer,
      filename: 'unity-jd.png',
      mimeType: 'image/png',
    });
    expect(created).toMatchObject({ created: true });
    expect(created.source).toMatchObject({
      inputType: 'image',
      status: 'needs_review',
      originalFilename: 'unity-jd.png',
      mimeType: 'image/png',
      parserId: 'vision-jd-extractor',
      requirements: [expect.objectContaining({
        text: '熟练使用 C# 与 Unity',
        sourceLocator: expect.objectContaining({ image: 1, line: 2 }),
      })],
    });
    expect(mocks.resolveLlmConfig).toHaveBeenCalledWith(userId, 'vision');
    expect(mocks.generateText).toHaveBeenCalledWith(expect.objectContaining({
      system: expect.stringContaining('untrusted data'),
      maxOutputTokens: 4_096,
      messages: [expect.objectContaining({
        content: expect.arrayContaining([
          expect.objectContaining({ type: 'image', image: expect.any(Buffer), mediaType: 'image/jpeg' }),
        ]),
      })],
    }));
    expect(mocks.generateText.mock.calls[0]?.[0]).not.toHaveProperty('providerOptions');

    const duplicate = await jdService.createImageSource(actor, {
      buffer,
      filename: 'unity-jd.png',
      mimeType: 'image/png',
    });
    expect(duplicate).toMatchObject({
      created: false,
      deduplicated: true,
      source: { id: created.source.id },
    });
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
  });

  it('persists an image parsing record before the Vision request completes', async () => {
    const buffer = await sharp({
      create: { width: 73, height: 73, channels: 3, background: '#dbeafe' },
    }).png().toBuffer();
    mocks.resolveLlmConfig.mockResolvedValueOnce({
      provider: 'openai-compatible',
      apiKey: 'test-only',
      baseURL: 'https://llm.test/v1',
      model: 'vision-test-model',
      capabilities: { vision: true },
    });
    let completeVision!: (value: { text: string }) => void;
    mocks.generateText.mockReturnValueOnce(new Promise((resolve) => {
      completeVision = resolve;
    }));

    const extraction = jdService.createImageSource(actor, {
      buffer,
      filename: 'slow-vision.png',
      mimeType: 'image/png',
    });
    await vi.waitFor(async () => {
      const sources = await jdService.listSources(actor);
      expect(sources.find((source) => source.originalFilename === 'slow-vision.png')).toMatchObject({
        status: 'parsing',
        lastRequestId: actor.requestId,
      });
    });

    completeVision({
      text: JSON.stringify({
        normalizedText: `Unity Technical Artist ${suffix}\n要求：熟悉 Shader`,
        title: 'Unity Technical Artist',
        company: '',
        jobTitle: 'Unity Technical Artist',
        location: '',
        requirements: [{
          requirementType: 'hard_skill',
          text: '熟悉 Shader',
          normalizedTerm: 'shader',
          aliases: [],
          priority: 'required',
          importance: 1,
          sourceText: '熟悉 Shader',
        }],
      }),
    });
    await expect(extraction).resolves.toMatchObject({
      created: true,
      deduplicated: false,
      source: { status: 'needs_review', lastRequestId: actor.requestId },
    });
  });

  it('does not send an image when the bound profile has not passed the Vision probe', async () => {
    const buffer = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#ff0000' },
    }).webp().toBuffer();
    mocks.resolveLlmConfig.mockResolvedValueOnce({
      provider: 'openai-compatible',
      apiKey: 'test-only',
      baseURL: 'https://llm.test/v1',
      model: 'text-only-model',
      capabilities: { vision: false },
    });

    await expect(jdService.createImageSource(actor, {
      buffer,
      filename: 'text-only.webp',
      mimeType: 'image/webp',
    })).rejects.toMatchObject({ code: 'LLM_VISION_REQUIRED', status: 422 });
    expect(mocks.generateText).not.toHaveBeenCalled();
    const failed = (await jdService.listSources(actor))
      .find((source) => source.originalFilename === 'text-only.webp');
    expect(failed).toMatchObject({
      status: 'failed',
      errorCode: 'LLM_VISION_REQUIRED',
      lastRequestId: actor.requestId,
    });
  });

  it('maps provider failures to actionable Vision errors without logging secrets', async () => {
    const buffer = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#ffffff' },
    }).png().toBuffer();
    mocks.resolveLlmConfig.mockResolvedValueOnce({
      provider: 'openai-compatible',
      apiKey: 'secret-must-not-be-logged',
      baseURL: 'https://llm.test/v1',
      model: 'vision-test-model',
      profileId: 'profile-safe-id',
      capabilities: { vision: true },
    });
    mocks.generateText.mockRejectedValueOnce(Object.assign(new Error('upstream auth rejected'), {
      statusCode: 401,
    }));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(jdService.createImageSource(actor, {
      buffer,
      filename: 'auth-failure.png',
      mimeType: 'image/png',
    })).rejects.toMatchObject({ code: 'LLM_AUTH_FAILED', status: 422 });

    expect(consoleError).toHaveBeenCalledWith('JD image extraction failed', expect.objectContaining({
      requestId: actor.requestId,
      profileId: 'profile-safe-id',
      code: 'LLM_AUTH_FAILED',
      upstreamStatus: 401,
    }));
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('secret-must-not-be-logged');
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('https://llm.test');
    const failed = (await jdService.listSources(actor))
      .find((source) => source.originalFilename === 'auth-failure.png');
    expect(failed).toMatchObject({
      status: 'failed',
      errorCode: 'LLM_AUTH_FAILED',
      lastRequestId: actor.requestId,
    });

    mocks.resolveLlmConfig.mockResolvedValueOnce({
      provider: 'openai-compatible',
      apiKey: 'test-only',
      baseURL: 'https://llm.test/v1',
      model: 'vision-test-model',
      capabilities: { vision: true },
    });
    mocks.generateText.mockResolvedValueOnce({
      text: JSON.stringify({
        normalizedText: `Unity Engineer ${suffix}\nRequired: C#`,
        title: 'Unity Engineer',
        company: '',
        jobTitle: 'Unity Engineer',
        location: '',
        requirements: [{
          requirementType: 'hard_skill',
          text: 'C#',
          normalizedTerm: 'c#',
          aliases: [],
          priority: 'required',
          importance: 1,
          sourceText: 'C#',
        }],
      }),
    });
    const retried = await jdService.createImageSource(actor, {
      buffer,
      filename: 'auth-failure.png',
      mimeType: 'image/png',
    });
    expect(retried).toMatchObject({
      created: false,
      deduplicated: false,
      source: {
        id: failed?.id,
        status: 'needs_review',
        errorCode: null,
        lastRequestId: actor.requestId,
      },
    });
    consoleError.mockRestore();
  });
});
