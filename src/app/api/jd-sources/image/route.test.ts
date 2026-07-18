import { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
  process.env.REGISTRATION_MODE = 'open';
  process.env.SEED_DEMO_DATA = 'false';
});

const mocks = vi.hoisted(() => ({ createImageSource: vi.fn() }));

vi.mock('@/lib/jd/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jd/service')>();
  return {
    ...actual,
    jdService: { createImageSource: mocks.createImageSource },
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
  const body = new FormData();
  body.set('title', 'Screenshot JD');
  body.set('file', new File([Buffer.from('image fixture')], 'job.png', { type: 'image/png' }));
  return new NextRequest('https://resume.test/api/jd-sources/image', {
    method: 'POST',
    headers: {
      cookie,
      origin,
      'x-request-id': `jd-image-route-${suffix}`,
    },
    body,
  });
}

beforeAll(async () => {
  await dbReady;
  await authRepository.setRegistrationMode('open');
  const registered = await authService.register({
    username: `jd_image_route_${suffix}`,
    password: 'JD image route password long enough',
  }, { requestId: `jd-image-route-register-${suffix}` });
  userId = registered.user.id;
  cookie = `jade_session=${registered.token}`;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createImageSource.mockResolvedValue({
    created: true,
    source: {
      id: `jd-image-${suffix}`,
      inputType: 'image',
      title: 'Screenshot JD',
      company: '',
      jobTitle: 'Unity Engineer',
      location: '',
      originalFilename: 'job.png',
      mimeType: 'image/png',
      sizeBytes: 13,
      contentHash: `sha256:${'7'.repeat(64)}`,
      normalizedText: 'Unity Engineer',
      status: 'needs_review',
      parserId: 'vision-jd-extractor',
      parserVersion: '1.0.0',
      errorCode: null,
      confirmedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      requirements: [],
    },
  });
});

describe('POST /api/jd-sources/image [JD-002]', () => {
  it('accepts one authenticated multipart image and returns a review source', async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      id: `jd-image-${suffix}`,
      inputType: 'image',
      status: 'needs_review',
      deduplicated: false,
    });
    expect(mocks.createImageSource).toHaveBeenCalledWith(
      expect.objectContaining({ userId }),
      expect.objectContaining({
        filename: 'job.png',
        mimeType: 'image/png',
        title: 'Screenshot JD',
        buffer: expect.any(Buffer),
      }),
    );
  });

  it('blocks an untrusted origin before processing the file', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const response = await POST(request('https://evil.test'));
      expect(response.status).toBe(403);
      expect(mocks.createImageSource).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
