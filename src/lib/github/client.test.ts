import { createHash, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { GitHubAppConfig } from './config';
import {
  decodeAndVerifyGitHubBlob,
  GitHubApiError,
  GitHubAppClient,
  GitHubPublicClient,
} from './client';

function testConfig(): GitHubAppConfig {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    appId: '12345',
    appSlug: 'jadeai-test',
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    webhookSecret: 'test-webhook-secret-long-enough',
    apiBaseUrl: 'https://api.github.test',
    webBaseUrl: 'https://github.test',
  };
}

function json(value: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
    ...init,
  });
}

describe('GitHub App client', () => {
  it('uses an app JWT only for installation token exchange', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(json({
      token: 'ephemeral-installation-token',
      expires_at: '2026-07-17T01:00:00Z',
      permissions: { contents: 'read', metadata: 'read' },
    }));
    const client = new GitHubAppClient(testConfig(), {
      fetch: fetchMock,
      now: () => new Date('2026-07-17T00:00:00Z'),
    });
    await expect(client.createInstallationToken('777')).resolves.toEqual({
      token: 'ephemeral-installation-token',
      expiresAt: '2026-07-17T01:00:00Z',
      permissions: { contents: 'read', metadata: 'read' },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.test/app/installations/777/access_tokens');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/);
    expect(JSON.stringify(init)).not.toContain('ephemeral-installation-token');
  });

  it('lists and normalizes installation repositories with the installation token', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ repositories: [{
      id: 91,
      node_id: 'R_91',
      name: 'career-facts',
      full_name: 'alice/career-facts',
      private: true,
      default_branch: 'main',
      archived: false,
      disabled: false,
    }] }));
    const client = new GitHubAppClient(testConfig(), { fetch: fetchMock });
    await expect(client.listInstallationRepositories('installation-token')).resolves.toEqual([{
      id: '91',
      nodeId: 'R_91',
      name: 'career-facts',
      fullName: 'alice/career-facts',
      private: true,
      defaultBranch: 'main',
      archived: false,
      disabled: false,
    }]);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('authorization'))
      .toBe('Bearer installation-token');
  });

  it('maps rate limiting without exposing a response body', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(json({}, {
      status: 403,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1784247000' },
    }));
    const client = new GitHubAppClient(testConfig(), { fetch: fetchMock });
    await expect(client.getRepository('token', '91')).rejects.toEqual(
      expect.objectContaining<Partial<GitHubApiError>>({ code: 'RATE_LIMITED', status: 429 }),
    );
  });
});

describe('public GitHub client', () => {
  it('uses only the fixed GitHub API origin and sends no credential', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(json({
      id: 91,
      node_id: 'R_91',
      name: 'career-facts',
      full_name: 'alice/career-facts',
      private: false,
      default_branch: 'main',
      archived: false,
      disabled: false,
    }));
    const client = new GitHubPublicClient({ fetch: fetchMock });
    await expect(client.getRepository('alice/career-facts')).resolves.toMatchObject({
      id: '91',
      fullName: 'alice/career-facts',
      private: false,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/alice/career-facts');
    expect(init?.cache).toBe('no-store');
    expect(init?.redirect).toBe('error');
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
  });

  it('maps anonymous API rate limiting to a stable retryable error', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(json({}, {
      status: 403,
      headers: { 'x-ratelimit-remaining': '0', 'retry-after': '60' },
    }));
    const client = new GitHubPublicClient({ fetch: fetchMock });
    await expect(client.getRepository('alice/career-facts')).rejects.toEqual(
      expect.objectContaining<Partial<GitHubApiError>>({ code: 'RATE_LIMITED', status: 429 }),
    );
  });
});

describe('Git blob verification', () => {
  it('decodes only content matching Git object size and SHA', () => {
    const bytes = Buffer.from('verified content\n');
    const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    expect(decodeAndVerifyGitHubBlob({
      sha,
      size: bytes.length,
      encoding: 'base64',
      content: bytes.toString('base64'),
    })).toEqual(bytes);
    expect(() => decodeAndVerifyGitHubBlob({
      sha: '0'.repeat(40),
      size: bytes.length,
      encoding: 'base64',
      content: bytes.toString('base64'),
    })).toThrowError(expect.objectContaining<Partial<GitHubApiError>>({ code: 'INVALID_RESPONSE' }));
  });
});
