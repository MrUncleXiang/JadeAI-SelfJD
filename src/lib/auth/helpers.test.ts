import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'true';
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
  process.env.REGISTRATION_MODE = 'open';
  process.env.SEED_DEMO_DATA = 'false';
});

import { dbReady } from '@/lib/db';
import { authRepository } from '@/lib/db/repositories/auth.repository';
import { authService } from './service';
import { getUserIdFromRequest, resolveUser } from './helpers';

let token = '';
let userId = '';

beforeAll(async () => {
  await dbReady;
  await authRepository.setRegistrationMode('open');
  const result = await authService.register({
    username: `helper_${crypto.randomUUID().slice(0, 8)}`,
    password: 'helper test password long enough',
  }, {
    requestId: 'helper-test',
  });
  token = result.token;
  userId = result.user.id;
});

describe('legacy route auth bridge', () => {
  it('resolves the database user from the opaque session cookie', async () => {
    const request = new Request('http://localhost/api/resume', {
      headers: { cookie: `jade_session=${token}`, 'x-fingerprint': 'attacker-controlled' },
    });
    const credential = getUserIdFromRequest(request);
    expect(credential).toBe(token);
    await expect(resolveUser(credential)).resolves.toMatchObject({ id: userId, authType: 'password' });
  });

  it('does not fall back to an attacker-controlled fingerprint when auth is enabled', async () => {
    const request = new Request('http://localhost/api/resume', {
      headers: { 'x-fingerprint': 'attacker-controlled' },
    });
    expect(getUserIdFromRequest(request)).toBeNull();
    await expect(resolveUser('not-a-valid-session-token-that-is-long-enough')).resolves.toBeNull();
  });
});
