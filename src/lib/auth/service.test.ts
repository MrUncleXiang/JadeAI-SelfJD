import { beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
  process.env.REGISTRATION_MODE = 'open';
  process.env.SEED_DEMO_DATA = 'false';
});

import { db, dbReady } from '@/lib/db';
import { authRateLimits, authSessions, invitations, passwordCredentials, users } from '@/lib/db/schema';
import { authRepository } from '@/lib/db/repositories/auth.repository';
import { hashOpaqueToken } from './tokens';
import { AuthServiceError, authService } from './service';

const suffix = crypto.randomUUID().slice(0, 8);
const username = `alice_${suffix}`;
const email = `Alice.${suffix}@Example.com`;
const password = 'correct horse battery staple';
const newPassword = 'new correct horse battery staple';
const metadata = {
  requestId: `request-${suffix}`,
  userAgent: 'vitest',
  ipPrefix: '203.0.113.0/24',
};

let userId = '';
let firstToken = '';

beforeAll(async () => {
  await dbReady;
  await authRepository.setRegistrationMode('open');
});

describe('password account lifecycle', () => {
  it('registers an account and stores only password/session hashes', async () => {
    const result = await authService.register({ username, email, password }, metadata);
    userId = result.user.id;
    firstToken = result.token;

    expect(result.user).toMatchObject({
      username,
      email,
      authType: 'password',
      role: 'user',
      status: 'active',
    });
    const credentials = await db
      .select()
      .from(passwordCredentials)
      .where(eq(passwordCredentials.userId, userId));
    expect(credentials[0]?.passwordHash).toMatch(/^\$scrypt\$/);
    expect(credentials[0]?.passwordHash).not.toContain(password);

    const sessions = await db
      .select()
      .from(authSessions)
      .where(eq(authSessions.userId, userId));
    expect(sessions[0]?.tokenHash).toBe(hashOpaqueToken(firstToken));
    expect(sessions[0]?.tokenHash).not.toBe(firstToken);
    await expect(authService.resolveSession(firstToken)).resolves.toMatchObject({ userId });
  });

  it('enforces normalized username and email uniqueness', async () => {
    await expect(authService.register({
      username: username.toUpperCase(),
      password,
    }, metadata)).rejects.toMatchObject({ code: 'IDENTIFIER_CONFLICT', status: 409 });

    await expect(authService.register({
      username: `other_${suffix}`,
      email: email.toLowerCase(),
      password,
    }, metadata)).rejects.toMatchObject({ code: 'IDENTIFIER_CONFLICT', status: 409 });
  });

  it('returns one public error for unknown users, wrong passwords and disabled users', async () => {
    await expect(authService.login({ identifier: `missing_${suffix}`, password }, metadata))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });
    await expect(authService.login({ identifier: username, password: 'this password is wrong' }, metadata))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });

    await db.update(users).set({ status: 'disabled' }).where(eq(users.id, userId));
    await expect(authService.login({ identifier: email, password }, metadata))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });
    await db.update(users).set({ status: 'active' }).where(eq(users.id, userId));
  });

  it('rate limits repeated login attempts and clears failures after success', async () => {
    const rateMetadata = {
      ...metadata,
      requestId: `rate-${suffix}`,
      ipPrefix: '198.51.100.0/24',
    };
    const rateKey = hashOpaqueToken(`login\u0000${username.toLowerCase()}\u0000${rateMetadata.ipPrefix}`);

    await expect(authService.login({ identifier: username, password: 'wrong password long enough' }, rateMetadata))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(db.select().from(authRateLimits).where(eq(authRateLimits.keyHash, rateKey)))
      .resolves.toHaveLength(1);

    await authService.login({ identifier: username, password }, rateMetadata);
    await expect(db.select().from(authRateLimits).where(eq(authRateLimits.keyHash, rateKey)))
      .resolves.toHaveLength(0);

    for (let attempt = 0; attempt <= 8; attempt += 1) {
      await authRepository.consumeRateLimit({
        keyHash: rateKey,
        scope: 'auth.login',
        maxAttempts: 8,
        windowMs: 15 * 60 * 1000,
        blockMs: 15 * 60 * 1000,
      });
    }
    await expect(authService.login({ identifier: username, password }, rateMetadata))
      .rejects.toMatchObject({ code: 'TOO_MANY_ATTEMPTS', status: 429 });
  });

  it('supports closed, invite and open registration modes with atomic invite use', async () => {
    await authRepository.setRegistrationMode('closed');
    await expect(authService.register({
      username: `closed_${suffix}`,
      password,
    }, metadata)).rejects.toMatchObject({ code: 'REGISTRATION_CLOSED' });

    await authRepository.setRegistrationMode('invite');
    await expect(authService.register({
      username: `noinvite_${suffix}`,
      password,
    }, metadata)).rejects.toMatchObject({ code: 'INVITATION_REQUIRED' });

    const invitationCode = `invite-${crypto.randomUUID()}`;
    await db.insert(invitations).values({
      id: crypto.randomUUID(),
      codeHash: hashOpaqueToken(invitationCode),
      maxUses: 1,
    });
    const invited = await authService.register({
      username: `invited_${suffix}`,
      password,
      invitationCode,
    }, metadata);
    expect(invited.user.username).toBe(`invited_${suffix}`);

    await expect(authService.register({
      username: `second_${suffix}`,
      password,
      invitationCode,
    }, metadata)).rejects.toMatchObject({ code: 'INVALID_INVITATION' });
    await authRepository.setRegistrationMode('open');
  });

  it('invalidates every old session when the password changes', async () => {
    const secondLogin = await authService.login({ identifier: email.toLowerCase(), password }, metadata);
    await authService.changePassword(userId, password, newPassword);

    await expect(authService.resolveSession(firstToken)).resolves.toBeNull();
    await expect(authService.resolveSession(secondLogin.token)).resolves.toBeNull();
    await expect(authService.login({ identifier: username, password }, metadata))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    const newLogin = await authService.login({ identifier: username, password: newPassword }, metadata);
    await expect(authService.resolveSession(newLogin.token)).resolves.toMatchObject({ userId });

    const activeOldSessions = await db
      .select()
      .from(authSessions)
      .where(and(eq(authSessions.userId, userId), eq(authSessions.tokenVersion, 0)));
    expect(activeOldSessions.every((session: { revokedAt: Date | null }) => session.revokedAt !== null)).toBe(true);
  });

  it('rejects passwords outside the reviewed policy', async () => {
    await expect(authService.changePassword(userId, newPassword, 'too-short'))
      .rejects.toBeInstanceOf(AuthServiceError);
  });

  it('allows bootstrap exactly until the first active administrator exists', async () => {
    const results = await Promise.allSettled([
      authService.bootstrapAdmin({
        username: `admin_${suffix}`,
        email: `admin.${suffix}@example.com`,
        password: 'bootstrap admin password long enough',
      }),
      authService.bootstrapAdmin({
        username: `admin2_${suffix}`,
        password: 'another bootstrap password long enough',
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rejection = results.find((result) => result.status === 'rejected');
    expect(rejection).toMatchObject({ reason: { code: 'BOOTSTRAP_DISABLED' } });

    const admins = await db.select().from(users).where(and(
      eq(users.role, 'admin'),
      eq(users.status, 'active'),
    ));
    expect(admins).toHaveLength(1);
  });
});
