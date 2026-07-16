import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
  process.env.REGISTRATION_MODE = 'open';
  process.env.SEED_DEMO_DATA = 'false';
});

import { dbReady } from '@/lib/db';
import { authRepository } from '@/lib/db/repositories/auth.repository';
import { hashOpaqueToken } from '@/lib/auth/tokens';
import { GET as getMe, PATCH as patchMe } from '@/app/api/me/route';
import { POST as changePassword } from '@/app/api/me/password/route';
import { POST as login } from './login/route';
import { POST as logout } from './logout/route';
import { POST as register } from './register/route';

const suffix = crypto.randomUUID().slice(0, 8);
const username = `route_${suffix}`;
const password = 'route test password long enough';
const nextPassword = 'route test next password long enough';

function jsonRequest(path: string, body: unknown, cookie?: string, origin?: string) {
  return new NextRequest(`https://resume.test${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(origin ? { origin } : {}),
      'x-request-id': `route-${suffix}`,
    },
    body: JSON.stringify(body),
  });
}

function sessionCookie(response: Response): string {
  const setCookie = response.headers.get('set-cookie') || '';
  const match = /(?:^|,\s*)jade_session=([^;]+)/.exec(setCookie);
  if (!match) throw new Error(`Missing jade_session cookie: ${setCookie}`);
  return `jade_session=${match[1]}`;
}

beforeAll(async () => {
  await dbReady;
  await authRepository.setRegistrationMode('open');
});

describe('password auth routes', () => {
  it('runs register, session lookup, profile update, password change and logout end to end', async () => {
    const registerResponse = await register(jsonRequest('/api/auth/register', {
      username,
      email: `${username}@example.com`,
      password,
    }));
    expect(registerResponse.status).toBe(201);
    const registered = await registerResponse.json();
    expect(registered).toMatchObject({ username, authType: 'password', role: 'user' });
    expect(JSON.stringify(registered)).not.toContain(password);
    let cookie = sessionCookie(registerResponse);

    const meResponse = await getMe(new NextRequest('https://resume.test/api/me', {
      headers: { cookie, 'x-request-id': `route-${suffix}` },
    }));
    expect(meResponse.status).toBe(200);
    await expect(meResponse.json()).resolves.toMatchObject({ username });

    const profileRequest = jsonRequest('/api/me', {
      displayName: 'Route Test User',
    }, cookie);
    const profileResponse = await patchMe(profileRequest);
    expect(profileResponse.status).toBe(200);
    await expect(profileResponse.json()).resolves.toMatchObject({ displayName: 'Route Test User' });

    const passwordResponse = await changePassword(jsonRequest('/api/me/password', {
      currentPassword: password,
      newPassword: nextPassword,
    }, cookie));
    expect(passwordResponse.status).toBe(204);
    expect(passwordResponse.headers.get('set-cookie')).toContain('jade_session=;');

    const staleSession = await getMe(new NextRequest('https://resume.test/api/me', {
      headers: { cookie },
    }));
    expect(staleSession.status).toBe(401);

    const loginResponse = await login(jsonRequest('/api/auth/login', {
      identifier: username,
      password: nextPassword,
    }));
    expect(loginResponse.status).toBe(200);
    cookie = sessionCookie(loginResponse);

    const logoutResponse = await logout(new NextRequest('https://resume.test/api/auth/logout', {
      method: 'POST',
      headers: { cookie },
    }));
    expect(logoutResponse.status).toBe(204);
    const loggedOut = await getMe(new NextRequest('https://resume.test/api/me', {
      headers: { cookie },
    }));
    expect(loggedOut.status).toBe(401);
  });

  it('uses the same public response for an unknown identifier and a wrong password', async () => {
    const unknown = await login(jsonRequest('/api/auth/login', {
      identifier: `missing_${suffix}`,
      password: nextPassword,
    }));
    const wrong = await login(jsonRequest('/api/auth/login', {
      identifier: username,
      password: 'wrong password but long enough',
    }));

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    const unknownBody = await unknown.json();
    const wrongBody = await wrong.json();
    expect({ code: unknownBody.code, message: unknownBody.message }).toEqual({
      code: wrongBody.code,
      message: wrongBody.message,
    });
  });

  it('rejects cross-origin credential submissions in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const response = await login(jsonRequest('/api/auth/login', {
        identifier: username,
        password: nextPassword,
      }, undefined, 'https://evil.test'));
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ code: 'UNTRUSTED_ORIGIN' });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('rejects non-JSON bodies before the auth service', async () => {
    const response = await login(new NextRequest('https://resume.test/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'not json',
    }));
    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('returns a standard retry hint after the login limit is reached', async () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', 'true');
    const ipPrefix = '192.0.2.0/24';
    const rateKey = hashOpaqueToken(`login\u0000${username.toLowerCase()}\u0000${ipPrefix}`);
    for (let attempt = 0; attempt <= 8; attempt += 1) {
      await authRepository.consumeRateLimit({
        keyHash: rateKey,
        scope: 'auth.login',
        maxAttempts: 8,
        windowMs: 15 * 60 * 1000,
        blockMs: 15 * 60 * 1000,
      });
    }
    try {
      const response = await login(new NextRequest('https://resume.test/api/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-real-ip': '192.0.2.17',
        },
        body: JSON.stringify({ identifier: username, password: nextPassword }),
      }));
      expect(response.status).toBe(429);
      expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
      await expect(response.json()).resolves.toMatchObject({ code: 'TOO_MANY_ATTEMPTS' });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
