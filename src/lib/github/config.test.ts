import { describe, expect, it } from 'vitest';

import { GitHubConfigError, githubInstallationUrl, loadGitHubAppConfig } from './config';

const baseEnv = {
  NODE_ENV: 'test',
  GITHUB_APP_ID: '12345',
  GITHUB_APP_SLUG: 'jadeai-career-test',
  GITHUB_APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----',
  GITHUB_WEBHOOK_SECRET: 'a-test-secret-with-enough-entropy',
  GITHUB_API_BASE_URL: 'http://127.0.0.1:3001',
  GITHUB_WEB_BASE_URL: 'http://127.0.0.1:3002',
} satisfies NodeJS.ProcessEnv;

describe('GitHub App configuration', () => {
  it('loads configuration lazily and expands escaped PEM newlines', () => {
    const config = loadGitHubAppConfig(baseEnv);
    expect(config.privateKey).toContain('PRIVATE KEY-----\ntest\n');
    expect(config.apiBaseUrl).toBe('http://127.0.0.1:3001');
    expect(githubInstallationUrl(config, 'one-time-state')).toBe(
      'http://127.0.0.1:3002/apps/jadeai-career-test/installations/new?state=one-time-state',
    );
  });

  it('fails closed when required secrets are absent', () => {
    expect(() => loadGitHubAppConfig({ ...baseEnv, GITHUB_WEBHOOK_SECRET: undefined }))
      .toThrowError(expect.objectContaining<Partial<GitHubConfigError>>({ code: 'MISSING_CONFIG' }));
  });

  it('requires HTTPS outside tests', () => {
    expect(() => loadGitHubAppConfig({ ...baseEnv, NODE_ENV: 'production' }))
      .toThrowError(expect.objectContaining<Partial<GitHubConfigError>>({ code: 'INVALID_CONFIG' }));
  });

  it('rejects a non-numeric GitHub App identifier', () => {
    expect(() => loadGitHubAppConfig({ ...baseEnv, GITHUB_APP_ID: 'Iv1.client-id' }))
      .toThrowError(expect.objectContaining<Partial<GitHubConfigError>>({ code: 'INVALID_CONFIG' }));
  });
});
