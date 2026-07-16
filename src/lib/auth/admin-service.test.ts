import { beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
  process.env.REGISTRATION_MODE = 'open';
  process.env.SEED_DEMO_DATA = 'false';
});

import { db, dbReady } from '@/lib/db';
import { auditEvents, invitations, users } from '@/lib/db/schema';
import { authRepository } from '@/lib/db/repositories/auth.repository';
import { adminAuthService } from './admin-service';
import { authService, type ActorContext } from './service';
import { hashOpaqueToken } from './tokens';

const suffix = crypto.randomUUID().slice(0, 8);
const adminPassword = 'admin service password long enough';
const userPassword = 'regular user password long enough';

let adminActor: ActorContext;
let userActor: ActorContext;
let adminToken = '';
let userToken = '';

beforeAll(async () => {
  await dbReady;
  await authRepository.setRegistrationMode('open');
  const admin = await authService.bootstrapAdmin({
    username: `adminsvc_${suffix}`,
    password: adminPassword,
  });
  const adminLogin = await authService.login({
    identifier: admin.username!,
    password: adminPassword,
  }, { requestId: 'admin-login' });
  adminToken = adminLogin.token;
  adminActor = (await authService.resolveSession(adminToken, 'admin-request'))!;

  const user = await authService.register({
    username: `usersvc_${suffix}`,
    password: userPassword,
  }, { requestId: 'user-register' });
  userToken = user.token;
  userActor = (await authService.resolveSession(userToken, 'user-request'))!;
});

describe('administrator account management', () => {
  it('denies administration to a normal user and lists only safe user fields', async () => {
    await expect(adminAuthService.listUsers(userActor, {}))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    const result = await adminAuthService.listUsers(adminActor, { page: 1, pageSize: 10 });
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(JSON.stringify(result.items)).not.toContain('passwordHash');
    expect(JSON.stringify(result.items)).not.toContain(adminToken);
  });

  it('protects the last active administrator', async () => {
    await expect(adminAuthService.updateUser(adminActor, adminActor.userId, { role: 'user' }))
      .rejects.toMatchObject({ code: 'LAST_ADMIN', status: 409 });
    await expect(adminAuthService.updateUser(adminActor, adminActor.userId, { status: 'disabled' }))
      .rejects.toMatchObject({ code: 'LAST_ADMIN', status: 409 });
  });

  it('revokes sessions immediately when an administrator disables a user', async () => {
    await adminAuthService.updateUser(adminActor, userActor.userId, { status: 'disabled' });
    await expect(authService.resolveSession(userToken)).resolves.toBeNull();
    await adminAuthService.updateUser(adminActor, userActor.userId, { status: 'active' });
    const login = await authService.login({
      identifier: userActor.user.username!,
      password: userPassword,
    }, { requestId: 'user-relogin' });
    userToken = login.token;
    userActor = (await authService.resolveSession(userToken, 'user-request-2'))!;
  });

  it('returns an invitation secret once and persists only its hash', async () => {
    const created = await adminAuthService.createInvitation(adminActor, {
      maxUses: 2,
      expiresInDays: 7,
    });
    expect(created.code).toHaveLength(32);

    const rows = await db.select().from(invitations).where(eq(invitations.id, created.invitation.id));
    expect(rows[0]?.codeHash).toBe(hashOpaqueToken(created.code));
    expect(JSON.stringify(rows[0])).not.toContain(created.code);
    const listed = await adminAuthService.listInvitations(adminActor);
    expect(JSON.stringify(listed)).not.toContain(created.code);
    await expect(adminAuthService.disableInvitation(adminActor, created.invitation.id)).resolves.toBe(true);
  });

  it('updates registration policy and records security-sensitive actions', async () => {
    await adminAuthService.setRegistrationMode(adminActor, 'invite');
    await expect(adminAuthService.getRegistrationMode(adminActor)).resolves.toBe('invite');
    const audits = await db.select().from(auditEvents);
    expect(audits.map((event: { action: string }) => event.action)).toEqual(expect.arrayContaining([
      'admin.user_updated',
      'admin.invitation_created',
      'admin.invitation_disabled',
      'admin.registration_mode_updated',
    ]));
  });

  it('serializes concurrent demotions so at least one active admin remains', async () => {
    await adminAuthService.updateUser(adminActor, userActor.userId, { role: 'admin' });
    userActor = (await authService.resolveSession(userToken, 'promoted-user-request'))!;
    expect(userActor.role).toBe('admin');

    const results = await Promise.allSettled([
      adminAuthService.updateUser(adminActor, adminActor.userId, { role: 'user' }),
      adminAuthService.updateUser(userActor, userActor.userId, { role: 'user' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const activeAdmins = await db.select().from(users).where(and(
      eq(users.role, 'admin'),
      eq(users.status, 'active'),
      isNull(users.deletedAt),
    ));
    expect(activeAdmins).toHaveLength(1);
  });
});
