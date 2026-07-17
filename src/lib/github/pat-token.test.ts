import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decryptGitHubPat, encryptGitHubPat, isFineGrainedGitHubPat } from './pat-token';

const KEY = Buffer.alloc(32, 7).toString('base64');
const TOKEN = `github_pat_${'A1_'.repeat(25)}`;

beforeEach(() => {
  vi.stubEnv('LLM_ENCRYPTION_KEYS', JSON.stringify({ 1: KEY }));
  vi.stubEnv('LLM_ENCRYPTION_ACTIVE_KEY_VERSION', '1');
});

describe('fine-grained GitHub PAT boundary', () => {
  it('accepts only the fine-grained token prefix and bounded opaque body', () => {
    expect(isFineGrainedGitHubPat(TOKEN)).toBe(true);
    expect(isFineGrainedGitHubPat(`ghp_${'a'.repeat(40)}`)).toBe(false);
    expect(isFineGrainedGitHubPat(`github_pat_${'a'.repeat(246)}`)).toBe(false);
    expect(isFineGrainedGitHubPat(`${TOKEN}\n`)).toBe(false);
  });

  it('binds ciphertext to both the tenant and connection', () => {
    const encrypted = encryptGitHubPat(TOKEN, { userId: 'user-a', connectionId: 'connection-a' });
    expect(JSON.stringify(encrypted)).not.toContain(TOKEN);
    expect(decryptGitHubPat(encrypted, {
      userId: 'user-a',
      connectionId: 'connection-a',
    })).toBe(TOKEN);
    expect(() => decryptGitHubPat(encrypted, {
      userId: 'user-b',
      connectionId: 'connection-a',
    })).toThrow('DECRYPTION_FAILED');
    expect(() => decryptGitHubPat(encrypted, {
      userId: 'user-a',
      connectionId: 'connection-b',
    })).toThrow('DECRYPTION_FAILED');
  });
});
