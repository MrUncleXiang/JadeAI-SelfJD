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

import { POST } from './route';

const suffix = crypto.randomUUID().slice(0, 8);
let userId = '';
let cookie = '';

function request(origin = 'https://resume.test') {
  return new NextRequest('https://resume.test/api/resumes/from-knowledge', {
    method: 'POST',
    headers: {
      cookie,
      origin,
      'content-type': 'application/json',
      'x-request-id': `knowledge-route-${suffix}`,
    },
    body: JSON.stringify({
      title: 'Unity Resume',
      targetRole: 'Unity Engineer',
      template: 'classic',
      language: 'en',
    }),
  });
}

beforeAll(async () => {
  await dbReady;
  await authRepository.setRegistrationMode('open');
  const registered = await authService.register({
    username: `knowledge_route_${suffix}`,
    password: 'knowledge route password long enough',
  }, { requestId: `knowledge-route-register-${suffix}` });
  userId = registered.user.id;
  cookie = `jade_session=${registered.token}`;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({
    resumeId: `resume-${suffix}`,
    changeSetId: `change-set-${suffix}`,
    title: 'Unity Resume',
    operationCount: 3,
  });
});

describe('POST /api/resumes/from-knowledge [KB-002]', () => {
  it('uses the authenticated tenant and returns the reviewable change set locator', async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      resumeId: `resume-${suffix}`,
      changeSetId: `change-set-${suffix}`,
      operationCount: 3,
    });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      userId,
      title: 'Unity Resume',
      targetRole: 'Unity Engineer',
      requestId: `knowledge-route-${suffix}`,
    }));
  });

  it('requires a trusted origin', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const response = await POST(request('https://evil.test'));
      expect(response.status).toBe(403);
      expect(mocks.create).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
