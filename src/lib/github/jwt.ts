import { createPrivateKey, sign } from 'node:crypto';

import type { GitHubAppConfig } from './config';

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

export function createGitHubAppJwt(
  config: Pick<GitHubAppConfig, 'appId' | 'privateKey'>,
  now = new Date(),
): string {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    iat: nowSeconds - 60,
    exp: nowSeconds + 9 * 60,
    iss: config.appId,
  }));
  const signingInput = `${header}.${payload}`;
  const key = createPrivateKey(config.privateKey);
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), key).toString('base64url');
  return `${signingInput}.${signature}`;
}
