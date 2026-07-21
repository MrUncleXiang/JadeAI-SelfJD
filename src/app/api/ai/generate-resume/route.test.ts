import { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
  process.env.REGISTRATION_MODE = 'open';
  process.env.SEED_DEMO_DATA = 'false';
});

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('@/lib/resume/from-knowledge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/resume/from-knowledge')>();
  return {
    ...actual,
    knowledgeResumeService: { create: mocks.create },
  };
});

import { authService } from '@/lib/auth/service';
import { dbReady } from '@/lib/db';
import { authRepository } from '@/lib/db/repositories/auth.repository';
import { KnowledgeResumeError } from '@/lib/resume/from-knowledge';

import { POST } from './route';

const suffix = crypto.randomUUID().slice(0, 8);
let cookie = '';

function request(body: Record<string, unknown>) {
  return new NextRequest('https://resume.test/api/ai/generate-resume', {
    method: 'POST',
    headers: {
      cookie,
      origin: 'https://resume.test',
      'content-type': 'application/json',
      'x-request-id': `gen-${suffix}`,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await dbReady;
  await authRepository.setRegistrationMode('open');
  const registered = await authService.register({
    username: `gen_route_${suffix}`,
    password: 'generate route password long enough',
  }, { requestId: `gen-route-register-${suffix}` });
  cookie = `jade_session=${registered.token}`;
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/ai/generate-resume Change Set migration [AI-001 AI-002]', () => {
  it('creates a reviewable knowledge-backed change set instead of writing live content', async () => {
    mocks.create.mockResolvedValue({
      resumeId: `resume-${suffix}`,
      changeSetId: `change-${suffix}`,
      title: 'Engineer - AI生成简历',
      operationCount: 3,
    });
    const response = await POST(request({
      jobTitle: 'Unity Engineer',
      yearsOfExperience: 3,
      skills: ['Unity', 'C#'],
      language: 'zh',
      template: 'classic',
    }));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      resumeId: `resume-${suffix}`,
      changeSetId: `change-${suffix}`,
      reviewRequired: true,
      operationCount: 3,
    });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      targetRole: 'Unity Engineer',
      language: 'zh',
      template: 'classic',
    }));
  });

  it('returns a closed-fail error when no approved facts exist', async () => {
    mocks.create.mockRejectedValue(new KnowledgeResumeError(
      'NO_APPROVED_FACTS',
      409,
      'Approve at least one career fact before generating a resume.',
    ));
    const response = await POST(request({ jobTitle: 'Engineer', language: 'en' }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'NO_APPROVED_FACTS' });
  });
});
