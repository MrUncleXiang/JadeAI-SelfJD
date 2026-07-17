import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;

export type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: number;
};

export class LlmEncryptionError extends Error {
  constructor(public readonly code:
    | 'ENCRYPTION_NOT_CONFIGURED'
    | 'INVALID_ENCRYPTION_CONFIG'
    | 'KEY_VERSION_NOT_FOUND'
    | 'DECRYPTION_FAILED'
  ) {
    super(code);
    this.name = 'LlmEncryptionError';
  }
}

type Keyring = {
  activeVersion: number;
  keys: Map<number, Buffer>;
};

function decodeMasterKey(encoded: string): Buffer {
  const value = encoded.trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) {
    throw new LlmEncryptionError('INVALID_ENCRYPTION_CONFIG');
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new LlmEncryptionError('INVALID_ENCRYPTION_CONFIG');
  }
  return key;
}

function parseVersion(value: string | undefined): number | null {
  if (!value) return null;
  const version = Number(value);
  return Number.isSafeInteger(version) && version > 0 ? version : null;
}

function readKeyring(): Keyring {
  const keys = new Map<number, Buffer>();
  const serialized = process.env.LLM_ENCRYPTION_KEYS?.trim();

  if (serialized) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized);
    } catch {
      throw new LlmEncryptionError('INVALID_ENCRYPTION_CONFIG');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new LlmEncryptionError('INVALID_ENCRYPTION_CONFIG');
    }
    for (const [rawVersion, encodedKey] of Object.entries(parsed)) {
      const version = parseVersion(rawVersion);
      if (!version || typeof encodedKey !== 'string' || keys.has(version)) {
        throw new LlmEncryptionError('INVALID_ENCRYPTION_CONFIG');
      }
      keys.set(version, decodeMasterKey(encodedKey));
    }
  } else if (process.env.LLM_ENCRYPTION_KEY?.trim()) {
    const configuredVersion = parseVersion(process.env.LLM_ENCRYPTION_KEY_VERSION);
    if (process.env.LLM_ENCRYPTION_KEY_VERSION && !configuredVersion) {
      throw new LlmEncryptionError('INVALID_ENCRYPTION_CONFIG');
    }
    const version = configuredVersion ?? 1;
    keys.set(version, decodeMasterKey(process.env.LLM_ENCRYPTION_KEY));
  } else {
    throw new LlmEncryptionError('ENCRYPTION_NOT_CONFIGURED');
  }

  if (keys.size === 0) {
    throw new LlmEncryptionError('INVALID_ENCRYPTION_CONFIG');
  }
  const configuredActiveVersion = parseVersion(process.env.LLM_ENCRYPTION_ACTIVE_KEY_VERSION);
  if (process.env.LLM_ENCRYPTION_ACTIVE_KEY_VERSION && !configuredActiveVersion) {
    throw new LlmEncryptionError('INVALID_ENCRYPTION_CONFIG');
  }
  const activeVersion = configuredActiveVersion ?? Math.max(...keys.keys());
  if (!keys.has(activeVersion)) {
    throw new LlmEncryptionError('KEY_VERSION_NOT_FOUND');
  }
  return { activeVersion, keys };
}

export interface SecretEncryptionContext {
  scope: string;
  userId: string;
  resourceId: string;
}

function associatedData(context: SecretEncryptionContext): Buffer {
  return Buffer.from(JSON.stringify({
    scope: context.scope,
    userId: context.userId,
    resourceId: context.resourceId,
  }), 'utf8');
}

function llmAssociatedData(context: { userId: string; profileId: string }): Buffer {
  // Keep the original AAD shape so credentials encrypted before generic secret
  // support was introduced remain decryptable after upgrading.
  return Buffer.from(JSON.stringify({
    scope: 'jadeai.llm-profile.v1',
    userId: context.userId,
    profileId: context.profileId,
  }), 'utf8');
}

function encryptWithAssociatedData(secret: string, aad: Buffer): EncryptedSecret {
  const keyring = readKeyring();
  const key = keyring.keys.get(keyring.activeVersion)!;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    keyVersion: keyring.activeVersion,
  };
}

function decryptWithAssociatedData(encrypted: EncryptedSecret, aad: Buffer): string {
  const keyring = readKeyring();
  const key = keyring.keys.get(encrypted.keyVersion);
  if (!key) throw new LlmEncryptionError('KEY_VERSION_NOT_FOUND');

  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(encrypted.iv, 'base64url'));
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new LlmEncryptionError('DECRYPTION_FAILED');
  }
}

export function encryptServerSecret(
  secret: string,
  context: SecretEncryptionContext,
): EncryptedSecret {
  return encryptWithAssociatedData(secret, associatedData(context));
}

export function decryptServerSecret(
  encrypted: EncryptedSecret,
  context: SecretEncryptionContext,
): string {
  return decryptWithAssociatedData(encrypted, associatedData(context));
}

export function encryptLlmApiKey(
  apiKey: string,
  context: { userId: string; profileId: string },
): EncryptedSecret {
  return encryptWithAssociatedData(apiKey, llmAssociatedData(context));
}

export function decryptLlmApiKey(
  encrypted: EncryptedSecret,
  context: { userId: string; profileId: string },
): string {
  return decryptWithAssociatedData(encrypted, llmAssociatedData(context));
}
