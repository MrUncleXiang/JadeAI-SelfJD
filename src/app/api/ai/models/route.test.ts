import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { AIConfigError } from '@/lib/ai/provider';

const mocks = vi.hoisted(() => ({
  resolveActor: vi.fn(),
  resolveOwnedLlmConfig: vi.fn(),
  providerFetch: vi.fn(),
}));

vi.mock('@/lib/auth/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth/api')>(),
  resolveActor: mocks.resolveActor,
}));

vi.mock('@/lib/llm/resolver', () => ({
  resolveOwnedLlmConfig: mocks.resolveOwnedLlmConfig,
}));

import { GET } from './route';

function request(profileId?: string) {
  const url = new URL('https://resume.test/api/ai/models');
  if (profileId) url.searchParams.set('profileId', profileId);
  return new NextRequest(url);
}

describe('GET /api/ai/models', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveActor.mockResolvedValue({
      actor: { userId: 'user-a', requestId: 'request-a' },
    });
  });

  it('requires an authenticated actor and explicit owned profile', async () => {
    mocks.resolveActor.mockResolvedValueOnce({ actor: null });
    const unauthorized = await GET(request('profile-a'));
    expect(unauthorized.status).toBe(401);
    expect(mocks.resolveOwnedLlmConfig).not.toHaveBeenCalled();

    const missingProfile = await GET(request());
    expect(missingProfile.status).toBe(400);
    await expect(missingProfile.json()).resolves.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('lists models with a server-resolved secret and never returns the secret', async () => {
    mocks.providerFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      data: [{ id: 'model-b' }, { id: 'model-a' }, { id: 'model-a' }],
    }), { status: 200 }));
    mocks.resolveOwnedLlmConfig.mockResolvedValueOnce({
      provider: 'openai-compatible',
      profileId: 'profile-a',
      apiKey: 'server-only-secret',
      baseURL: 'https://8.8.8.8/v1',
      model: 'model-a',
      fetch: mocks.providerFetch,
    });

    const response = await GET(request('profile-a'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.resolveOwnedLlmConfig).toHaveBeenCalledWith(
      'user-a',
      'profile-a',
      { allowInvalid: true },
    );
    expect(mocks.providerFetch).toHaveBeenCalledWith('https://8.8.8.8/v1/models', {
      headers: { Authorization: 'Bearer server-only-secret' },
    });
    const text = await response.text();
    expect(text).not.toContain('server-only-secret');
    expect(JSON.parse(text)).toEqual({ models: [{ id: 'model-a' }, { id: 'model-b' }] });
  });

  it('preserves safe resolver errors and caps provider responses before reading them', async () => {
    mocks.resolveOwnedLlmConfig.mockRejectedValueOnce(new AIConfigError(
      'LLM_PROFILE_NOT_FOUND',
      'LLM profile not found.',
      404,
    ));
    const missing = await GET(request('foreign-profile'));
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ code: 'LLM_PROFILE_NOT_FOUND' });

    mocks.resolveOwnedLlmConfig.mockResolvedValueOnce({
      provider: 'gemini',
      profileId: 'profile-a',
      apiKey: 'never-expose',
      baseURL: 'https://8.8.8.8/v1beta',
      model: 'gemini-test',
      fetch: mocks.providerFetch,
    });
    mocks.providerFetch.mockResolvedValueOnce(new Response('provider-secret-body', {
      status: 200,
      headers: { 'content-length': String(1024 * 1024 + 1) },
    }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const oversized = await GET(request('profile-a'));
    log.mockRestore();
    expect(oversized.status).toBe(502);
    const text = await oversized.text();
    expect(text).toContain('LLM_MODEL_LIST_FAILED');
    expect(text).not.toContain('provider-secret-body');
    expect(text).not.toContain('never-expose');
  });
});
