import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { getRequestMetadata, hasTrustedOrigin, readSessionToken, sessionExpiresAt } from './http';

describe('auth HTTP boundary', () => {
  it('reads only the named session cookie and tolerates malformed encoding', () => {
    expect(readSessionToken(new Request('http://localhost', {
      headers: { cookie: 'other=one; jade_session=opaque%2Etoken; last=two' },
    }))).toBe('opaque.token');
    expect(readSessionToken(new Request('http://localhost', {
      headers: { cookie: 'jade_session=%E0%A4%A' },
    }))).toBeNull();
  });

  it('enforces same-origin state changes in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      expect(hasTrustedOrigin(new NextRequest('https://resume.test/api/auth/login', {
        headers: { origin: 'https://resume.test' },
      }))).toBe(true);
      expect(hasTrustedOrigin(new NextRequest('https://resume.test/api/auth/login', {
        headers: { origin: 'https://evil.test' },
      }))).toBe(false);
      expect(hasTrustedOrigin(new NextRequest('https://resume.test/api/auth/login'))).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('bounds session lifetime and stores only coarse IP metadata', () => {
    const previous = process.env.SESSION_TTL_DAYS;
    process.env.SESSION_TTL_DAYS = '999';
    vi.stubEnv('TRUST_PROXY_HEADERS', 'true');
    try {
      const now = new Date('2026-01-01T00:00:00Z');
      expect(sessionExpiresAt(now).toISOString()).toBe('2026-04-01T00:00:00.000Z');
      expect(getRequestMetadata(new Request('http://localhost', {
        headers: {
          'x-forwarded-for': '203.0.113.42, 10.0.0.1',
          'x-request-id': 'request-1',
        },
      }))).toMatchObject({ requestId: 'request-1', ipPrefix: '203.0.113.0/24' });
    } finally {
      vi.unstubAllEnvs();
      if (previous === undefined) delete process.env.SESSION_TTL_DAYS;
      else process.env.SESSION_TTL_DAYS = previous;
    }
  });

  it('ignores untrusted proxy metadata and rejects unsafe request IDs', () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', 'false');
    try {
      const metadata = getRequestMetadata(new Request('http://localhost', {
        headers: {
          'x-forwarded-for': '203.0.113.42',
          'x-request-id': 'bad request id forged',
        },
      }));
      expect(metadata.ipPrefix).toBeNull();
      expect(metadata.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
