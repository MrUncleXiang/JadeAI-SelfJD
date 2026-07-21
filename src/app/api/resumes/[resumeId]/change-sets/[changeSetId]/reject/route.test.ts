import { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
  process.env.REGISTRATION_MODE = 'open';
  process.env.SEED_DEMO_DATA = 'false';
});

const mocks = vi.hoisted(() => ({ reject: vi.fn() }));

vi.mock('@/lib/resume-patch/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/resume-patch/service')>();
  return {
    ...actual,
    resumeChangeService: {
      ...actual.resumeChangeService,
      reject: mocks.reject,
    },
  };
});

import { authService } from '@/lib/auth/service';
import { dbReady } from '@/lib/db';
import { authRepository } from '@/lib/db/repositories/auth.repository';

import { POST } from './route';

const suffix = crypto.randomUUID().slice(0, 8);
let cookie = '';
const resumeId = `resume-${suffix}`;
const changeSetId = `change-${suffix}`;

function request(body: Record<string, unknown> = {}) {
  return new NextRequest(`https://resume.test/api/resumes/${resumeId}/change-sets/${changeSetId}/reject`, {
    method: 'POST',
    headers: {
      cookie,
      origin: 'https://resume.test',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await dbReady;
  await authRepository.setRegistrationMode('open');
  const registered = await authService.register({
    username: `reject_route_${suffix}`,
    password: 'reject route password long enough',
  }, { requestId: `reject-route-register-${suffix}` });
  cookie = `jade_session=${registered.token}`;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reject.mockResolvedValue({
    id: changeSetId,
    resumeId,
    status: 'rejected',
    operations: [],
  });
});

describe('POST /api/resumes/{resumeId}/change-sets/{changeSetId}/reject [AI-002]', () => {
  it('rejects an applicable change set for the authenticated tenant', async () => {
    const response = await POST(request({ note: 'not relevant' }), {
      params: Promise.resolve({ resumeId, changeSetId }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: 'rejected' });
    expect(mocks.reject).toHaveBeenCalledWith(expect.objectContaining({
      resumeId,
      changeSetId,
      note: 'not relevant',
    }));
  });

  it('requires authentication', async () => {
    const response = await POST(new NextRequest(
      `https://resume.test/api/resumes/${resumeId}/change-sets/${changeSetId}/reject`,
      { method: 'POST', headers: { origin: 'https://resume.test' } },
    ), { params: Promise.resolve({ resumeId, changeSetId }) });
    expect(response.status).toBe(401);
  });
});
