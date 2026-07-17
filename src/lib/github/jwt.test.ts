import { generateKeyPairSync, verify } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createGitHubAppJwt } from './jwt';

describe('GitHub App JWT', () => {
  it('creates a short-lived RS256 token with the app id as issuer', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const now = new Date('2026-07-17T00:00:00.000Z');
    const jwt = createGitHubAppJwt({
      appId: '123456',
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    }, now);
    const [header, payload, signature] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString('utf8'))).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))).toEqual({
      iat: Math.floor(now.getTime() / 1000) - 60,
      exp: Math.floor(now.getTime() / 1000) + 540,
      iss: '123456',
    });
    expect(verify(
      'RSA-SHA256',
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, 'base64url'),
    )).toBe(true);
  });
});
