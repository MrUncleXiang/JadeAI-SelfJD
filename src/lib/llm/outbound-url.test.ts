import { describe, expect, it } from 'vitest';

import { validateLlmBaseUrl, validateLlmRequestUrl } from './outbound-url';

const lookup = (addresses: string[]) => async () => addresses.map((address) => ({
  address,
  family: (address.includes(':') ? 6 : 4) as 4 | 6,
}));

describe('LLM BaseURL outbound policy', () => {
  it('accepts HTTPS only when every resolved address is public', async () => {
    await expect(validateLlmBaseUrl('https://llm.example/v1', {
      lookup: lookup(['8.8.8.8', '2606:4700:4700::1111']),
      allowlist: '',
    })).resolves.toBe('https://llm.example/v1');

    await expect(validateLlmBaseUrl('https://llm.example/v1', {
      lookup: lookup(['8.8.8.8', '10.0.0.7']),
      allowlist: '',
    })).rejects.toMatchObject({ code: 'BASE_URL_BLOCKED' });
  });

  it.each([
    'https://127.0.0.1/v1',
    'https://169.254.169.254/latest',
    'https://10.0.0.1/v1',
    'https://192.168.1.10/v1',
    'https://[::1]/v1',
    'https://[::ffff:127.0.0.1]/v1',
    'https://[::ffff:10.0.0.1]/v1',
    'https://[fe80::1]/v1',
    'https://[fc00::1]/v1',
  ])('blocks non-public literal address %s', async (url) => {
    await expect(validateLlmBaseUrl(url, { allowlist: '' }))
      .rejects.toMatchObject({ code: 'BASE_URL_BLOCKED' });
  });

  it('blocks HTTP, credentials, fragments and query parameters by default', async () => {
    await expect(validateLlmBaseUrl('http://8.8.8.8/v1', { allowlist: '' }))
      .rejects.toMatchObject({ code: 'BASE_URL_BLOCKED' });
    await expect(validateLlmBaseUrl('https://user:pass@8.8.8.8/v1', { allowlist: '' }))
      .rejects.toMatchObject({ code: 'INVALID_BASE_URL' });
    await expect(validateLlmBaseUrl('https://8.8.8.8/v1?token=secret', { allowlist: '' }))
      .rejects.toMatchObject({ code: 'INVALID_BASE_URL' });
  });

  it('allows an exact operator-approved local origin or CIDR', async () => {
    await expect(validateLlmBaseUrl('http://127.0.0.1:11434/v1', {
      allowlist: 'http://127.0.0.1:11434',
    })).resolves.toBe('http://127.0.0.1:11434/v1');

    await expect(validateLlmBaseUrl('http://ollama.internal:11434/v1', {
      lookup: lookup(['10.30.1.7']),
      allowlist: '10.30.0.0/16',
    })).resolves.toBe('http://ollama.internal:11434/v1');
  });

  it('fails closed for malformed allowlist entries and DNS failures', async () => {
    await expect(validateLlmBaseUrl('https://8.8.8.8/v1', {
      allowlist: 'not-an-origin',
    })).rejects.toMatchObject({ code: 'INVALID_BASE_URL_ALLOWLIST' });
    await expect(validateLlmBaseUrl('https://missing.example/v1', {
      lookup: async () => { throw new Error('ENOTFOUND'); },
      allowlist: '',
    })).rejects.toMatchObject({ code: 'BASE_URL_DNS_FAILED' });
  });

  it('revalidates concrete SDK requests while allowing provider query parameters', async () => {
    await expect(validateLlmRequestUrl(
      'https://llm.example/v1/models?alt=sse',
      'https://llm.example/v1',
      { lookup: lookup(['8.8.8.8']), allowlist: '' },
    )).resolves.toMatchObject({
      url: 'https://llm.example/v1/models?alt=sse',
      addresses: [{ address: '8.8.8.8', family: 4 }],
    });

    await expect(validateLlmRequestUrl(
      'https://other.example/v1/models',
      'https://llm.example/v1',
      { lookup: lookup(['8.8.8.8']), allowlist: '' },
    )).rejects.toMatchObject({ code: 'BASE_URL_BLOCKED' });

    await expect(validateLlmRequestUrl(
      'https://llm.example/admin',
      'https://llm.example/v1',
      { lookup: lookup(['8.8.8.8']), allowlist: '' },
    )).rejects.toMatchObject({ code: 'BASE_URL_BLOCKED' });
  });
});
