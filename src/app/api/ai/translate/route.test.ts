import { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
  process.env.REGISTRATION_MODE = 'open';
  process.env.SEED_DEMO_DATA = 'false';
});

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  resolveLlmConfig: vi.fn(),
}));

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    generateText: mocks.generateText,
  };
});

vi.mock('@/lib/llm/resolver', () => ({
  resolveLlmConfig: mocks.resolveLlmConfig,
}));

import { authService } from '@/lib/auth/service';
import { dbReady } from '@/lib/db';
import { authRepository } from '@/lib/db/repositories/auth.repository';
import { resumeRepository } from '@/lib/db/repositories/resume.repository';
import { resumeChangeService } from '@/lib/resume-patch/service';

import { POST } from './route';

const suffix = crypto.randomUUID().slice(0, 8);
let cookie = '';
let userId = '';

function request(body: Record<string, unknown>) {
  return new NextRequest('https://resume.test/api/ai/translate', {
    method: 'POST',
    headers: {
      cookie,
      origin: 'https://resume.test',
      'content-type': 'application/json',
      'x-request-id': `translate-${suffix}`,
    },
    body: JSON.stringify(body),
  });
}

async function readNdjson(response: Response) {
  const text = await response.text();
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

beforeAll(async () => {
  await dbReady;
  await authRepository.setRegistrationMode('open');
  const registered = await authService.register({
    username: `translate_route_${suffix}`,
    password: 'translate route password long enough',
  }, { requestId: `translate-route-register-${suffix}` });
  cookie = `jade_session=${registered.token}`;
  userId = registered.user.id;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveLlmConfig.mockResolvedValue({
    provider: 'openai-compatible',
    wireApi: 'chat-completions',
    apiKey: 'test-key',
    baseURL: 'https://llm.invalid/v1',
    model: 'test-model',
    capabilities: { json: true },
  });
  mocks.generateText.mockImplementation(async ({ prompt }: { prompt: string }) => {
    const section = JSON.parse(prompt.slice(prompt.indexOf('{'))) as {
      sectionId: string;
      title: string;
      content: Record<string, unknown>;
    };
    return {
      text: JSON.stringify({
        sectionId: section.sectionId,
        title: 'Summary',
        content: { text: 'Focused on Unity client development' },
      }),
    };
  });
});

describe('POST /api/ai/translate Change Set migration [AI-002]', () => {
  it('creates a reviewable translation proposal without mutating the live resume', async () => {
    const resume = await resumeRepository.createOwned(userId, {
      title: `Translate fixture ${suffix}`,
      language: 'zh',
      template: 'classic',
    });
    expect(resume).toBeTruthy();
    const section = await resumeRepository.createSectionOwned(userId, {
      resumeId: resume!.id,
      type: 'summary',
      title: '个人总结',
      sortOrder: 0,
      content: { text: '专注 Unity 客户端开发' },
    });
    expect(section).toBeTruthy();

    const response = await POST(request({
      resumeId: resume!.id,
      targetLanguage: 'en',
      mode: 'overwrite',
    }));
    expect(response.status).toBe(200);
    const events = await readNdjson(response);
    expect(events.some((event) => event.type === 'progress')).toBe(true);
    const done = events.find((event) => event.type === 'done');
    expect(done).toMatchObject({
      resumeId: resume!.id,
      language: 'en',
      reviewRequired: true,
      failedCount: 0,
      operationCount: 3,
    });
    expect(done?.changeSetId).toEqual(expect.any(String));

    const live = await resumeRepository.findOwnedById(userId, resume!.id);
    expect(live?.language).toBe('zh');
    expect(live?.sections[0]).toMatchObject({
      title: '个人总结',
      content: { text: '专注 Unity 客户端开发' },
    });

    const changeSet = await resumeChangeService.getChangeSet(userId, resume!.id, done!.changeSetId as string);
    expect(changeSet.operations.map((operation) => operation.type)).toEqual([
      'set_section_title',
      'set_field',
      'set_language',
    ]);
  });
});
