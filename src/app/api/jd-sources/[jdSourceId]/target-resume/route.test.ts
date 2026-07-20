import { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
  process.env.REGISTRATION_MODE = 'open';
  process.env.SEED_DEMO_DATA = 'false';
});

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('@/lib/resume/targeted', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/resume/targeted')>();
  return {
    ...actual,
    targetedResumeService: { create: mocks.create },
  };
});

import { authService } from '@/lib/auth/service';
import { dbReady } from '@/lib/db';
import { authRepository } from '@/lib/db/repositories/auth.repository';

import { POST } from './route';

const suffix = crypto.randomUUID().slice(0, 8);
const jdSourceId = `jd-${suffix}`;
let userId = '';
let cookie = '';

function request(
  body: Record<string, unknown> = {},
  origin = 'https://resume.test',
) {
  return new NextRequest(`https://resume.test/api/jd-sources/${jdSourceId}/target-resume`, {
    method: 'POST',
    headers: {
      cookie,
      origin,
      'content-type': 'application/json',
      'x-request-id': `target-route-${suffix}`,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await dbReady;
  await authRepository.setRegistrationMode('open');
  const registered = await authService.register({
    username: `target_route_${suffix}`,
    password: 'target route password long enough',
  }, { requestId: `target-route-register-${suffix}` });
  userId = registered.user.id;
  cookie = `jade_session=${registered.token}`;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({
    resumeId: `resume-${suffix}`,
    changeSetId: `change-set-${suffix}`,
    title: 'Targeted Resume',
    operationCount: 4,
    baseResumeId: `base-${suffix}`,
    jdSourceId,
  });
});

describe('POST /api/jd-sources/{jdSourceId}/target-resume [JD-004]', () => {
  it('uses the authenticated tenant and returns a reviewable target locator', async () => {
    const response = await POST(request({
      baseResumeId: `base-${suffix}`,
      title: 'Targeted Resume',
      language: 'en',
    }), { params: Promise.resolve({ jdSourceId }) });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      resumeId: `resume-${suffix}`,
      changeSetId: `change-set-${suffix}`,
      jdSourceId,
      operationCount: 4,
    });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      userId,
      jdSourceId,
      baseResumeId: `base-${suffix}`,
      requestId: `target-route-${suffix}`,
    }));
  });

  it('requires a trusted origin', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const response = await POST(request({}, 'https://evil.test'), {
        params: Promise.resolve({ jdSourceId }),
      });
      expect(response.status).toBe(403);
      expect(mocks.create).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('rejects a base version without a base resume', async () => {
    const response = await POST(request({ baseVersionId: `version-${suffix}` }), {
      params: Promise.resolve({ jdSourceId }),
    });
    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
