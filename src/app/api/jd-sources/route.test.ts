import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
  process.env.REGISTRATION_MODE = 'open';
  process.env.SEED_DEMO_DATA = 'false';
});

import { NextRequest } from 'next/server';

import { authService } from '@/lib/auth/service';
import { dbReady } from '@/lib/db';
import { authRepository } from '@/lib/db/repositories/auth.repository';

import { POST as confirmSource } from './[jdSourceId]/confirm/route';
import { GET as getSource, PATCH as updateSource } from './[jdSourceId]/route';
import { GET as listSources, POST as createSource } from './route';

const suffix = crypto.randomUUID().slice(0, 8);
let ownerCookie = '';
let otherCookie = '';

function request(pathname: string, cookie = ownerCookie) {
  return new NextRequest(`https://resume.test${pathname}`, {
    headers: { cookie, 'x-request-id': `jd-route-${suffix}` },
  });
}

function jsonRequest(pathname: string, body: unknown, cookie = ownerCookie, method = 'POST', origin = 'https://resume.test') {
  return new NextRequest(`https://resume.test${pathname}`, {
    method,
    headers: {
      cookie,
      origin,
      'content-type': 'application/json',
      'x-request-id': `jd-route-${suffix}`,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await dbReady;
  await authRepository.setRegistrationMode('open');
  const owner = await authService.register({
    username: `jd_route_owner_${suffix}`,
    password: 'JD route owner password long enough',
  }, { requestId: `jd-route-owner-${suffix}` });
  const other = await authService.register({
    username: `jd_route_other_${suffix}`,
    password: 'JD route other password long enough',
  }, { requestId: `jd-route-other-${suffix}` });
  ownerCookie = `jade_session=${owner.token}`;
  otherCookie = `jade_session=${other.token}`;
});

describe('JD source routes', () => {
  it('creates, deduplicates, lists, and isolates text JD sources', async () => {
    expect((await listSources(request('/api/jd-sources', ''))).status).toBe(401);

    const created = await createSource(jsonRequest('/api/jd-sources', {
      title: 'Unity Engineer',
      text: 'Unity Engineer\nRequired: C# and Unity',
    }));
    expect(created.status).toBe(201);
    expect(created.headers.get('cache-control')).toBe('no-store');
    const source = await created.json() as { id: string; status: string; contentHash: string };
    expect(source).toMatchObject({ status: 'draft' });
    expect(source.contentHash).toMatch(/^sha256:/);

    const duplicate = await createSource(jsonRequest('/api/jd-sources', {
      text: 'Unity Engineer\r\nRequired: C# and Unity\r\n',
    }));
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({ id: source.id, deduplicated: true });

    const listed = await listSources(request('/api/jd-sources'));
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toHaveLength(1);
    await expect((await listSources(request('/api/jd-sources', otherCookie))).json()).resolves.toEqual([]);

    const foreign = await getSource(request(`/api/jd-sources/${source.id}`, otherCookie), {
      params: Promise.resolve({ jdSourceId: source.id }),
    });
    expect(foreign.status).toBe(404);
  });

  it('saves reviewed requirements and requires explicit confirmation', async () => {
    const created = await createSource(jsonRequest('/api/jd-sources', {
      text: `Senior engineer ${suffix}\nResponsibilities\nBuild reliable tools`,
    }));
    const source = await created.json() as { id: string };

    const earlyConfirm = await confirmSource(jsonRequest(`/api/jd-sources/${source.id}/confirm`, {}), {
      params: Promise.resolve({ jdSourceId: source.id }),
    });
    expect(earlyConfirm.status).toBe(409);

    const reviewed = await updateSource(jsonRequest(`/api/jd-sources/${source.id}`, {
      title: 'Senior engineer',
      company: 'Example',
      jobTitle: 'Senior Engineer',
      requirements: [{
        requirementType: 'responsibility',
        text: 'Build reliable tools',
        normalizedTerm: 'reliable tooling',
        priority: 'required',
        importance: 0.9,
        sourceLocator: { line: 3 },
      }],
    }, ownerCookie, 'PATCH'), {
      params: Promise.resolve({ jdSourceId: source.id }),
    });
    expect(reviewed.status).toBe(200);
    await expect(reviewed.json()).resolves.toMatchObject({
      status: 'needs_review',
      requirements: [expect.objectContaining({ text: 'Build reliable tools' })],
    });

    const confirmed = await confirmSource(jsonRequest(`/api/jd-sources/${source.id}/confirm`, {}), {
      params: Promise.resolve({ jdSourceId: source.id }),
    });
    expect(confirmed.status).toBe(200);
    await expect(confirmed.json()).resolves.toMatchObject({ status: 'confirmed' });
  });

  it('rejects untrusted origins and invalid request media types', async () => {
    const blocked = await createSource(jsonRequest('/api/jd-sources', {
      text: 'Blocked source',
    }, ownerCookie, 'POST', 'https://evil.test'));
    expect(blocked.status).toBe(403);

    const unsupported = await createSource(new NextRequest('https://resume.test/api/jd-sources', {
      method: 'POST',
      headers: { cookie: ownerCookie, origin: 'https://resume.test', 'content-type': 'text/plain' },
      body: 'not json',
    }));
    expect(unsupported.status).toBe(415);
  });
});
