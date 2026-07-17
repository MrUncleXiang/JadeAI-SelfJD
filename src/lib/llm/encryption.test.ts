import { createCipheriv } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  decryptLlmApiKey,
  encryptLlmApiKey,
  LlmEncryptionError,
} from './encryption';

const KEY_V1 = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
const KEY_V2 = 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=';
const context = { userId: 'user-a', profileId: 'profile-a' };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.sequential('LLM API key encryption', () => {
  it('encrypts with random AES-GCM IVs and never embeds plaintext', () => {
    vi.stubEnv('LLM_ENCRYPTION_KEYS', JSON.stringify({ 1: KEY_V1 }));
    vi.stubEnv('LLM_ENCRYPTION_ACTIVE_KEY_VERSION', '1');

    const first = encryptLlmApiKey('sk-secret-value', context);
    const second = encryptLlmApiKey('sk-secret-value', context);

    expect(first.keyVersion).toBe(1);
    expect(first.iv).not.toBe(second.iv);
    expect(JSON.stringify(first)).not.toContain('sk-secret-value');
    expect(decryptLlmApiKey(first, context)).toBe('sk-secret-value');
  });

  it('decrypts an old record after the active key rotates', () => {
    vi.stubEnv('LLM_ENCRYPTION_KEYS', JSON.stringify({ 1: KEY_V1 }));
    vi.stubEnv('LLM_ENCRYPTION_ACTIVE_KEY_VERSION', '1');
    const oldRecord = encryptLlmApiKey('old-secret', context);

    vi.stubEnv('LLM_ENCRYPTION_KEYS', JSON.stringify({ 1: KEY_V1, 2: KEY_V2 }));
    vi.stubEnv('LLM_ENCRYPTION_ACTIVE_KEY_VERSION', '2');
    const newRecord = encryptLlmApiKey('new-secret', context);

    expect(newRecord.keyVersion).toBe(2);
    expect(decryptLlmApiKey(oldRecord, context)).toBe('old-secret');
    expect(decryptLlmApiKey(newRecord, context)).toBe('new-secret');
  });

  it('decrypts records written with the original profileId AAD format', () => {
    vi.stubEnv('LLM_ENCRYPTION_KEYS', JSON.stringify({ 1: KEY_V1 }));
    vi.stubEnv('LLM_ENCRYPTION_ACTIVE_KEY_VERSION', '1');

    const iv = Buffer.alloc(12, 7);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(KEY_V1, 'base64'), iv);
    cipher.setAAD(Buffer.from(JSON.stringify({
      scope: 'jadeai.llm-profile.v1',
      userId: context.userId,
      profileId: context.profileId,
    }), 'utf8'));
    const ciphertext = Buffer.concat([
      cipher.update('legacy-secret', 'utf8'),
      cipher.final(),
    ]);
    const legacyRecord = {
      ciphertext: ciphertext.toString('base64url'),
      iv: iv.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
      keyVersion: 1,
    };

    expect(decryptLlmApiKey(legacyRecord, context)).toBe('legacy-secret');
  });

  it('rejects swapped ownership metadata and tampered ciphertext', () => {
    vi.stubEnv('LLM_ENCRYPTION_KEYS', JSON.stringify({ 1: KEY_V1 }));
    const encrypted = encryptLlmApiKey('tenant-secret', context);

    expect(() => decryptLlmApiKey(encrypted, { ...context, userId: 'user-b' }))
      .toThrowError(expect.objectContaining({ code: 'DECRYPTION_FAILED' }));
    expect(() => decryptLlmApiKey({ ...encrypted, ciphertext: `${encrypted.ciphertext}A` }, context))
      .toThrowError(expect.objectContaining({ code: 'DECRYPTION_FAILED' }));
  });

  it('fails closed when deployment key material is missing or invalid', () => {
    vi.stubEnv('LLM_ENCRYPTION_KEYS', '');
    vi.stubEnv('LLM_ENCRYPTION_KEY', '');
    expect(() => encryptLlmApiKey('secret', context)).toThrowError(
      new LlmEncryptionError('ENCRYPTION_NOT_CONFIGURED'),
    );

    vi.stubEnv('LLM_ENCRYPTION_KEYS', JSON.stringify({ 1: 'too-short' }));
    expect(() => encryptLlmApiKey('secret', context)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ENCRYPTION_CONFIG' }),
    );

    vi.stubEnv('LLM_ENCRYPTION_KEYS', '');
    vi.stubEnv('LLM_ENCRYPTION_KEY', KEY_V1);
    vi.stubEnv('LLM_ENCRYPTION_KEY_VERSION', 'not-a-version');
    expect(() => encryptLlmApiKey('secret', context)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ENCRYPTION_CONFIG' }),
    );
  });
});
