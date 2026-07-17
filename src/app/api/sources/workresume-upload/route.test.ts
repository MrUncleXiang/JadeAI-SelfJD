import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
  process.env.REGISTRATION_MODE = 'open';
  process.env.SEED_DEMO_DATA = 'false';
});

import { authService } from '@/lib/auth/service';
import { db, dbReady } from '@/lib/db';
import { authRepository } from '@/lib/db/repositories/auth.repository';
import {
  auditEvents,
  careerFacts,
  sourceDocuments,
  sourceRepositories,
  sourceSnapshots,
} from '@/lib/db/schema';
import { WORKRESUME_UPLOAD_MAX_REQUEST_BYTES } from '@/lib/source/workresume-upload';

import { GET, POST } from './route';

const suffix = crypto.randomUUID().slice(0, 8);
const fixtureRoot = path.resolve('tests/fixtures/workresume-v2');
let ownerCookie = '';
let otherCookie = '';

interface FixtureEntry {
  path: string;
  bytes: Buffer;
}

async function fixtureEntries(directory = fixtureRoot, prefix = ''): Promise<FixtureEntry[]> {
  const entries: FixtureEntry[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) entries.push(...await fixtureEntries(path.join(directory, item.name), relative));
    else if (item.isFile()) entries.push({ path: relative, bytes: await readFile(path.join(directory, item.name)) });
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

function cookie(token: string) {
  return `jade_session=${token}`;
}

function getRequest(sessionCookie = ownerCookie) {
  return new NextRequest('https://resume.test/api/sources/workresume-upload', {
    headers: { cookie: sessionCookie, 'x-request-id': `upload-get-${suffix}` },
  });
}

async function uploadRequest(
  entries: FixtureEntry[],
  sessionCookie = ownerCookie,
  origin = 'https://resume.test',
) {
  const form = new FormData();
  form.set('schemaVersion', '1');
  form.set('sourceName', 'Browser WorkResume');
  for (const entry of entries) {
    form.append('paths', `MyResume/${entry.path}`);
    form.append('files', new File([new Uint8Array(entry.bytes).buffer], path.basename(entry.path)));
  }
  return new NextRequest('https://resume.test/api/sources/workresume-upload', {
    method: 'POST',
    headers: {
      cookie: sessionCookie,
      origin,
      'x-request-id': `upload-post-${suffix}`,
    },
    body: form,
  });
}

beforeAll(async () => {
  await dbReady;
  await authRepository.setRegistrationMode('open');
  const owner = await authService.register({
    username: `upload_owner_${suffix}`,
    password: 'upload owner password long enough',
  }, { requestId: `upload-owner-${suffix}` });
  const other = await authService.register({
    username: `upload_other_${suffix}`,
    password: 'upload other password long enough',
  }, { requestId: `upload-other-${suffix}` });
  ownerCookie = cookie(owner.token);
  otherCookie = cookie(other.token);
});

describe('WorkResume upload route', () => {
  it('requires authentication and a trusted origin before parsing multipart data', async () => {
    expect((await GET(new NextRequest('https://resume.test/api/sources/workresume-upload'))).status).toBe(401);

    const fixture = await fixtureEntries();
    expect((await POST(await uploadRequest(fixture, ''))).status).toBe(401);

    vi.stubEnv('NODE_ENV', 'production');
    try {
      const blocked = await POST(await uploadRequest(fixture, ownerCookie, 'https://evil.test'));
      expect(blocked.status).toBe(403);
      await expect(blocked.json()).resolves.toMatchObject({ code: 'UNTRUSTED_ORIGIN' });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('imports a directory, returns a safe DTO, and replays the same revision idempotently', async () => {
    const fixture = await fixtureEntries();
    const created = await POST(await uploadRequest(fixture));
    expect(created.status).toBe(201);
    expect(created.headers.get('cache-control')).toBe('no-store');
    const first = await created.json() as Record<string, unknown>;
    expect(first).toMatchObject({
      alreadyImported: false,
      uploadedFiles: 7,
      documentsCreated: 7,
      factsCreated: 4,
      source: {
        kind: 'uploaded-workresume',
        name: 'Browser WorkResume',
        lastRevision: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    });
    expect(JSON.stringify(first)).not.toContain('capabilities.json');
    const firstRevision = (first.source as { lastRevision: string }).lastRevision;

    const replay = await POST(await uploadRequest(fixture));
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      alreadyImported: true,
      documentsCreated: 0,
      factsCreated: 0,
    });

    await expect(db.select().from(sourceRepositories)).resolves.toHaveLength(1);
    await expect(db.select().from(sourceSnapshots)).resolves.toHaveLength(1);
    await expect(db.select().from(sourceDocuments)).resolves.toHaveLength(7);
    await expect(db.select().from(careerFacts)).resolves.toHaveLength(4);

    const status = await GET(getRequest());
    await expect(status.json()).resolves.toMatchObject({ source: { kind: 'uploaded-workresume' } });
    const otherStatus = await GET(getRequest(otherCookie));
    await expect(otherStatus.json()).resolves.toEqual({ source: null });

    const changedFixture = await fixtureEntries();
    const capabilityIndex = changedFixture.findIndex((entry) => entry.path.endsWith('capabilities.json'));
    const pool = JSON.parse(changedFixture[capabilityIndex].bytes.toString('utf8'));
    pool.terms[0].lastVerified = '2026-07-17';
    changedFixture[capabilityIndex] = {
      ...changedFixture[capabilityIndex],
      bytes: Buffer.from(JSON.stringify(pool, null, 2)),
    };
    const changed = await POST(await uploadRequest(changedFixture));
    expect(changed.status).toBe(201);
    const second = await changed.json() as {
      alreadyImported: boolean;
      evidenceMarkedStale: number;
      source: { lastRevision: string };
    };
    expect(second.alreadyImported).toBe(false);
    expect(second.source.lastRevision).not.toBe(firstRevision);
    expect(second.evidenceMarkedStale).toBeGreaterThan(0);
    await expect(db.select().from(sourceSnapshots)).resolves.toHaveLength(2);
  });

  it('rejects selected secrets without persisting plaintext or sensitive audit metadata', async () => {
    const fixture = await fixtureEntries();
    const capabilityIndex = fixture.findIndex((entry) => entry.path.endsWith('capabilities.json'));
    const pool = JSON.parse(fixture[capabilityIndex].bytes.toString('utf8'));
    const secret = 'not-a-real-route-secret-value-12345';
    pool.api_key = secret;
    fixture[capabilityIndex] = { ...fixture[capabilityIndex], bytes: Buffer.from(JSON.stringify(pool)) };

    const response = await POST(await uploadRequest(fixture));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: 'SECRET_DETECTED' });
    expect(JSON.stringify(await db.select().from(sourceDocuments))).not.toContain(secret);
    const audits = await db.select().from(auditEvents);
    expect(JSON.stringify(audits)).not.toContain(secret);
    expect(JSON.stringify(audits)).not.toContain('capabilities.json');
  });

  it('rejects non-multipart requests with a correlated non-cacheable error', async () => {
    const response = await POST(new NextRequest('https://resume.test/api/sources/workresume-upload', {
      method: 'POST',
      headers: {
        cookie: ownerCookie,
        origin: 'https://resume.test',
        'content-type': 'application/json',
        'x-request-id': `upload-media-${suffix}`,
      },
      body: '{}',
    }));
    expect(response.status).toBe(415);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBe(`upload-media-${suffix}`);
    await expect(response.json()).resolves.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('bounds a chunked multipart body even without Content-Length', async () => {
    let remaining = WORKRESUME_UPLOAD_MAX_REQUEST_BYTES + 1;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (remaining <= 0) {
          controller.close();
          return;
        }
        const size = Math.min(1024 * 1024, remaining);
        controller.enqueue(new Uint8Array(size));
        remaining -= size;
      },
    });
    const init = {
      method: 'POST',
      headers: {
        cookie: ownerCookie,
        origin: 'https://resume.test',
        'content-type': 'multipart/form-data; boundary=bounded-upload',
        'x-request-id': `upload-size-${suffix}`,
      },
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' };
    const request = new NextRequest(new Request(
      'https://resume.test/api/sources/workresume-upload',
      init,
    ));
    expect(request.headers.get('content-length')).toBeNull();

    const response = await POST(request);
    expect(response.status).toBe(413);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });
});
