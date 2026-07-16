import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  close: vi.fn(),
}));

vi.mock('undici', () => ({
  Agent: class Agent {
    close = mocks.close;
  },
  fetch: mocks.fetch,
}));

import { createLlmProviderFetch } from './transport';

describe('LLM guarded provider transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pins a validated request and disables automatic redirects', async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const guardedFetch = createLlmProviderFetch('https://8.8.8.8/v1');

    const response = await guardedFetch('https://8.8.8.8/v1/models?alt=sse');

    expect(response.status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.fetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
    expect(mocks.fetch.mock.calls[0][1].dispatcher).toBeDefined();
  });

  it('blocks cross-origin requests and every provider redirect', async () => {
    const guardedFetch = createLlmProviderFetch('https://8.8.8.8/v1');
    await expect(guardedFetch('https://1.1.1.1/v1/models'))
      .rejects.toMatchObject({ code: 'OUTBOUND_URL_BLOCKED' });
    expect(mocks.fetch).not.toHaveBeenCalled();

    mocks.fetch.mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: 'https://127.0.0.1/private' },
    }));
    await expect(guardedFetch('https://8.8.8.8/v1/models'))
      .rejects.toMatchObject({ code: 'OUTBOUND_REDIRECT_BLOCKED' });
  });
});
