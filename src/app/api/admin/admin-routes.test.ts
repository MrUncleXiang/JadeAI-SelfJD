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
import { authService } from '@/lib/auth/service';
import { GET as listUsers } from './users/route';
import { PATCH as updateUser } from './users/[userId]/route';
import { GET as listInvitations, POST as createInvitation } from './invitations/route';

const suffix = crypto.randomUUID().slice(0, 8);
let adminCookie = '';
let userCookie = '';
let userId = '';

function cookie(token: string) {
  return `jade_session=${token}`;
}

function jsonRequest(path: string, body: unknown, sessionCookie: string, method = 'POST') {
  return new NextRequest(`https://resume.test${path}`, {
    method,
    headers: {
      cookie: sessionCookie,
      'content-type': 'application/json',
      'x-request-id': `admin-route-${suffix}`,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await dbReady;
  await authRepository.setRegistrationMode('open');
  const admin = await authService.bootstrapAdmin({
    username: `routeadmin_${suffix}`,
    password: 'admin route password long enough',
  });
  const adminLogin = await authService.login({
    identifier: admin.username!,
    password: 'admin route password long enough',
  }, { requestId: 'admin-route-login' });
  adminCookie = cookie(adminLogin.token);

  const user = await authService.register({
    username: `routeuser_${suffix}`,
    password: 'user route password long enough',
  }, { requestId: 'user-route-register' });
  userId = user.user.id;
  userCookie = cookie(user.token);
});

describe('administrator routes', () => {
  it('requires an administrator and returns a safe paginated user list', async () => {
    const forbidden = await listUsers(new NextRequest('https://resume.test/api/admin/users', {
      headers: { cookie: userCookie },
    }));
    expect(forbidden.status).toBe(403);

    const response = await listUsers(new NextRequest('https://resume.test/api/admin/users?page=1&pageSize=20', {
      headers: { cookie: adminCookie },
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);
    expect(JSON.stringify(body)).not.toContain('passwordHash');
  });

  it('updates user status and revokes that user session', async () => {
    const response = await updateUser(
      jsonRequest(`/api/admin/users/${userId}`, { status: 'disabled' }, adminCookie, 'PATCH'),
      { params: Promise.resolve({ userId }) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: userId, status: 'disabled' });

    const token = userCookie.slice('jade_session='.length);
    await expect(authService.resolveSession(token)).resolves.toBeNull();
  });

  it('returns a new invitation secret once and omits it from list responses', async () => {
    const created = await createInvitation(jsonRequest('/api/admin/invitations', {
      maxUses: 3,
      expiresInDays: 14,
    }, adminCookie));
    expect(created.status).toBe(201);
    expect(created.headers.get('cache-control')).toBe('no-store');
    const createdBody = await created.json();
    expect(createdBody.code).toHaveLength(32);

    const listed = await listInvitations(new NextRequest('https://resume.test/api/admin/invitations', {
      headers: { cookie: adminCookie },
    }));
    expect(listed.status).toBe(200);
    const listBody = await listed.json();
    expect(listBody).toHaveLength(1);
    expect(JSON.stringify(listBody)).not.toContain(createdBody.code);
    expect(listBody[0]).not.toHaveProperty('code');
  });
});
