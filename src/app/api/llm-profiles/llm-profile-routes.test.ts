import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
  process.env.REGISTRATION_MODE = 'open';
  process.env.SEED_DEMO_DATA = 'false';
  process.env.LLM_ENCRYPTION_KEYS = JSON.stringify({
    1: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
  });
  process.env.LLM_ENCRYPTION_ACTIVE_KEY_VERSION = '1';
  process.env.LLM_BASE_URL_ALLOWLIST = '';
});

const probeMocks = vi.hoisted(() => ({
  probe: vi.fn(),
}));

vi.mock('@/lib/llm/probe', () => ({
  probeLlmCapabilities: probeMocks.probe,
}));

import { db, dbReady } from '@/lib/db';
import { authRepository } from '@/lib/db/repositories/auth.repository';
import { auditEvents, llmFeatureBindings, llmProfiles } from '@/lib/db/schema';
import { authService } from '@/lib/auth/service';
import { decryptLlmApiKey } from '@/lib/llm/encryption';
import { resolveLlmConfig } from '@/lib/llm/resolver';
import { GET as listProfiles, POST as createProfile } from './route';
import { DELETE as deleteProfile, PATCH as updateProfile } from './[profileId]/route';
import { POST as testProfile } from './[profileId]/test/route';
import { GET as listBindings } from '../llm-bindings/route';
import { PUT as setBinding } from '../llm-bindings/[feature]/route';

const suffix = crypto.randomUUID().slice(0, 8);
const firstKey = `sk-first-${suffix}`;
const secondKey = `sk-second-${suffix}`;
let ownerCookie = '';
let otherCookie = '';
let ownerId = '';
let otherId = '';

function cookie(token: string) {
  return `jade_session=${token}`;
}

function jsonRequest(path: string, body: unknown, sessionCookie: string, method = 'POST') {
  return new NextRequest(`https://resume.test${path}`, {
    method,
    headers: {
      cookie: sessionCookie,
      origin: 'https://resume.test',
      'content-type': 'application/json',
      'x-request-id': `llm-route-${suffix}`,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await dbReady;
  await authRepository.setRegistrationMode('open');
  const owner = await authService.register({
    username: `llm_owner_${suffix}`,
    password: 'LLM owner route password long enough',
  }, { requestId: `llm-owner-${suffix}` });
  const other = await authService.register({
    username: `llm_other_${suffix}`,
    password: 'LLM other route password long enough',
  }, { requestId: `llm-other-${suffix}` });
  ownerCookie = cookie(owner.token);
  otherCookie = cookie(other.token);
  ownerId = owner.user.id;
  otherId = other.user.id;
});

describe('LLM profile routes', () => {
  it('stores encrypted user-owned profiles and never returns key material', async () => {
    const createdResponse = await createProfile(jsonRequest('/api/llm-profiles', {
      name: 'Primary OpenAI',
      provider: 'openai-compatible',
      baseUrl: 'https://8.8.8.8/v1',
      modelName: 'test-model',
      apiKey: firstKey,
    }, ownerCookie));
    expect(createdResponse.status).toBe(201);
    expect(createdResponse.headers.get('cache-control')).toBe('no-store');
    const createdText = await createdResponse.text();
    expect(createdText).not.toContain(firstKey);
    expect(createdText).not.toContain('encryptedApiKey');
    const created = JSON.parse(createdText) as {
      id: string;
      hasApiKey: boolean;
      wireApi: 'chat-completions' | 'responses';
    };
    expect(created.hasApiKey).toBe(true);
    expect(created.wireApi).toBe('chat-completions');

    const rows = await db.select().from(llmProfiles).where(eq(llmProfiles.id, created.id)).limit(1);
    expect(rows[0]?.encryptedApiKey).not.toBe(firstKey);
    expect(JSON.stringify(rows[0])).not.toContain(firstKey);
    expect(decryptLlmApiKey({
      ciphertext: rows[0].encryptedApiKey,
      iv: rows[0].keyIv,
      tag: rows[0].keyTag,
      keyVersion: rows[0].keyVersion,
    }, { userId: ownerId, profileId: created.id })).toBe(firstKey);

    const listedResponse = await listProfiles(new NextRequest('https://resume.test/api/llm-profiles', {
      headers: { cookie: ownerCookie },
    }));
    expect(listedResponse.status).toBe(200);
    const listedText = await listedResponse.text();
    expect(listedText).not.toContain(firstKey);
    expect(JSON.parse(listedText)).toHaveLength(1);

    const otherList = await listProfiles(new NextRequest('https://resume.test/api/llm-profiles', {
      headers: { cookie: otherCookie },
    }));
    await expect(otherList.json()).resolves.toEqual([]);

    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const crossTenantPatch = await updateProfile(
      jsonRequest(`/api/llm-profiles/${created.id}`, { name: 'Stolen' }, otherCookie, 'PATCH'),
      { params: Promise.resolve({ profileId: created.id }) },
    );
    expect(crossTenantPatch.status).toBe(404);
    const crossTenantDelete = await deleteProfile(new NextRequest(
      `https://resume.test/api/llm-profiles/${created.id}`,
      { method: 'DELETE', headers: { cookie: otherCookie, origin: 'https://resume.test' } },
    ), { params: Promise.resolve({ profileId: created.id }) });
    expect(crossTenantDelete.status).toBe(404);
    log.mockRestore();

    const renamed = await updateProfile(
      jsonRequest(`/api/llm-profiles/${created.id}`, { name: 'Renamed' }, ownerCookie, 'PATCH'),
      { params: Promise.resolve({ profileId: created.id }) },
    );
    expect(renamed.status).toBe(200);
    const afterRename = await db.select().from(llmProfiles).where(eq(llmProfiles.id, created.id)).limit(1);
    expect(afterRename[0].encryptedApiKey).toBe(rows[0].encryptedApiKey);

    const switchedProtocol = await updateProfile(
      jsonRequest(`/api/llm-profiles/${created.id}`, { wireApi: 'responses' }, ownerCookie, 'PATCH'),
      { params: Promise.resolve({ profileId: created.id }) },
    );
    expect(switchedProtocol.status).toBe(200);
    await expect(switchedProtocol.json()).resolves.toMatchObject({ wireApi: 'responses', status: 'untested' });

    const rotated = await updateProfile(
      jsonRequest(`/api/llm-profiles/${created.id}`, { apiKey: secondKey }, ownerCookie, 'PATCH'),
      { params: Promise.resolve({ profileId: created.id }) },
    );
    expect(rotated.status).toBe(200);
    expect(await rotated.text()).not.toContain(secondKey);
    const afterRotation = await db.select().from(llmProfiles).where(eq(llmProfiles.id, created.id)).limit(1);
    expect(afterRotation[0].encryptedApiKey).not.toBe(rows[0].encryptedApiKey);
    expect(decryptLlmApiKey({
      ciphertext: afterRotation[0].encryptedApiKey,
      iv: afterRotation[0].keyIv,
      tag: afterRotation[0].keyTag,
      keyVersion: afterRotation[0].keyVersion,
    }, { userId: ownerId, profileId: created.id })).toBe(secondKey);
    const auditRows = await db.select().from(auditEvents);
    expect(JSON.stringify(auditRows)).not.toContain(firstKey);
    expect(JSON.stringify(auditRows)).not.toContain(secondKey);

    const foreignBinding = await setBinding(
      jsonRequest('/api/llm-bindings/resume', { profileId: created.id }, otherCookie, 'PUT'),
      { params: Promise.resolve({ feature: 'resume' }) },
    );
    expect(foreignBinding.status).toBe(404);

    const testLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const foreignTest = await testProfile(new NextRequest(
      `https://resume.test/api/llm-profiles/${created.id}/test`,
      { method: 'POST', headers: { cookie: otherCookie, origin: 'https://resume.test' } },
    ), { params: Promise.resolve({ profileId: created.id }) });
    expect(foreignTest.status).toBe(404);
    expect(probeMocks.probe).not.toHaveBeenCalled();
    testLog.mockRestore();

    const bound = await setBinding(
      jsonRequest('/api/llm-bindings/resume', { profileId: created.id }, ownerCookie, 'PUT'),
      { params: Promise.resolve({ feature: 'resume' }) },
    );
    expect(bound.status).toBe(200);
    await expect(bound.json()).resolves.toEqual({ feature: 'resume', profileId: created.id });
    const bindings = await listBindings(new NextRequest('https://resume.test/api/llm-bindings', {
      headers: { cookie: ownerCookie },
    }));
    await expect(bindings.json()).resolves.toMatchObject({
      resume: created.id,
      jd: null,
      vision: null,
      interview: null,
    });

    const resolved = await resolveLlmConfig(ownerId, 'resume');
    expect(resolved).toMatchObject({
      profileId: created.id,
      provider: 'openai-compatible',
      wireApi: 'responses',
      baseURL: 'https://8.8.8.8/v1',
      model: 'test-model',
      apiKey: secondKey,
    });
    expect(resolved.fetch).toBeTypeOf('function');
    await expect(resolveLlmConfig(otherId, 'resume')).rejects.toMatchObject({
      code: 'LLM_PROFILE_REQUIRED',
      status: 422,
    });

    probeMocks.probe.mockResolvedValueOnce({
      reachable: true,
      json: true,
      tools: false,
      vision: true,
      errors: { tools: 'UNSUPPORTED' },
      latencyMs: 123,
    });
    const tested = await testProfile(new NextRequest(
      `https://resume.test/api/llm-profiles/${created.id}/test`,
      { method: 'POST', headers: { cookie: ownerCookie, origin: 'https://resume.test' } },
    ), { params: Promise.resolve({ profileId: created.id }) });
    expect(tested.status).toBe(200);
    await expect(tested.json()).resolves.toMatchObject({
      id: created.id,
      status: 'active',
      hasApiKey: true,
      capabilities: {
        reachable: true,
        json: true,
        tools: false,
        vision: true,
        errors: { tools: 'UNSUPPORTED' },
        latencyMs: 123,
      },
    });
    expect(probeMocks.probe).toHaveBeenCalledWith(expect.objectContaining({
      profileId: created.id,
      apiKey: secondKey,
    }));

    const deleted = await deleteProfile(new NextRequest(
      `https://resume.test/api/llm-profiles/${created.id}`,
      { method: 'DELETE', headers: { cookie: ownerCookie, origin: 'https://resume.test' } },
    ), { params: Promise.resolve({ profileId: created.id }) });
    expect(deleted.status).toBe(204);
    await expect(db.select().from(llmProfiles).where(eq(llmProfiles.id, created.id)))
      .resolves.toHaveLength(0);
    await expect(db.select().from(llmFeatureBindings).where(
      eq(llmFeatureBindings.llmProfileId, created.id),
    )).resolves.toHaveLength(0);
  });

  it('requires authentication, trusted origins and a configured deployment key', async () => {
    const unauthorized = await listProfiles(new NextRequest('https://resume.test/api/llm-profiles'));
    expect(unauthorized.status).toBe(401);

    vi.stubEnv('NODE_ENV', 'production');
    try {
      const untrusted = await createProfile(new NextRequest('https://resume.test/api/llm-profiles', {
        method: 'POST',
        headers: {
          cookie: ownerCookie,
          origin: 'https://evil.test',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Blocked',
          provider: 'openai-compatible',
          baseUrl: 'https://8.8.8.8/v1',
          modelName: 'test-model',
          apiKey: 'should-not-be-stored',
        }),
      }));
      expect(untrusted.status).toBe(403);
    } finally {
      vi.unstubAllEnvs();
    }

    vi.stubEnv('LLM_ENCRYPTION_KEYS', '');
    vi.stubEnv('LLM_ENCRYPTION_KEY', '');
    try {
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const unavailable = await createProfile(jsonRequest('/api/llm-profiles', {
        name: 'No encryption',
        provider: 'openai-compatible',
        baseUrl: 'https://8.8.8.8/v1',
        modelName: 'test-model',
        apiKey: 'must-not-be-stored',
      }, ownerCookie));
      expect(unavailable.status).toBe(503);
      await expect(unavailable.json()).resolves.toMatchObject({
        code: 'LLM_ENCRYPTION_UNAVAILABLE',
      });
      log.mockRestore();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
