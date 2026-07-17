import type { EncryptedSecret } from '@/lib/llm/encryption';
import {
  decryptServerSecret,
  encryptServerSecret,
} from '@/lib/llm/encryption';

export const GITHUB_PAT_SECRET_SCOPE = 'jadeai.github-fine-grained-pat.v1';
const FINE_GRAINED_PAT = /^github_pat_[A-Za-z0-9_]{20,244}$/;

export function isFineGrainedGitHubPat(value: string): boolean {
  return value.length <= 255
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value)
    && FINE_GRAINED_PAT.test(value);
}

export function encryptGitHubPat(
  token: string,
  context: { userId: string; connectionId: string },
): EncryptedSecret {
  return encryptServerSecret(token, {
    scope: GITHUB_PAT_SECRET_SCOPE,
    userId: context.userId,
    resourceId: context.connectionId,
  });
}

export function decryptGitHubPat(
  encrypted: EncryptedSecret,
  context: { userId: string; connectionId: string },
): string {
  return decryptServerSecret(encrypted, {
    scope: GITHUB_PAT_SECRET_SCOPE,
    userId: context.userId,
    resourceId: context.connectionId,
  });
}
