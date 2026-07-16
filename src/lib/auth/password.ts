import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';

const ALGORITHM = 'scrypt';
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const DEFAULT_LOG_N = 15;
const DEFAULT_R = 8;
const DEFAULT_P = 1;
const MAX_MEMORY = 64 * 1024 * 1024;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

interface ScryptParameters {
  logN: number;
  r: number;
  p: number;
}

function scrypt(
  password: string,
  salt: Buffer,
  parameters: ScryptParameters,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(
      password,
      salt,
      KEY_LENGTH,
      {
        N: 2 ** parameters.logN,
        r: parameters.r,
        p: parameters.p,
        maxmem: MAX_MEMORY,
      },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

function encode(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function decode(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

function parseParameters(value: string): ScryptParameters | null {
  const match = /^ln=(\d+),r=(\d+),p=(\d+)$/.exec(value);
  if (!match) return null;
  const parameters = {
    logN: Number(match[1]),
    r: Number(match[2]),
    p: Number(match[3]),
  };
  if (
    !Number.isInteger(parameters.logN)
    || parameters.logN < 14
    || parameters.logN > 20
    || !Number.isInteger(parameters.r)
    || parameters.r < 1
    || parameters.r > 32
    || !Number.isInteger(parameters.p)
    || parameters.p < 1
    || parameters.p > 16
  ) {
    return null;
  }
  return parameters;
}

export function validatePassword(password: string): string | null {
  if (typeof password !== 'string') return 'Password must be a string';
  const byteLength = Buffer.byteLength(password, 'utf8');
  if (byteLength > 1024) {
    return `Password must contain at most ${PASSWORD_MAX_LENGTH} characters`;
  }
  const length = Array.from(password).length;
  if (length < PASSWORD_MIN_LENGTH) {
    return `Password must contain at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (length > PASSWORD_MAX_LENGTH) {
    return `Password must contain at most ${PASSWORD_MAX_LENGTH} characters`;
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const validationError = validatePassword(password);
  if (validationError) throw new Error(validationError);

  const salt = randomBytes(SALT_LENGTH);
  const parameters = {
    logN: DEFAULT_LOG_N,
    r: DEFAULT_R,
    p: DEFAULT_P,
  };
  const derivedKey = await scrypt(password, salt, parameters);
  return `$${ALGORITHM}$ln=${parameters.logN},r=${parameters.r},p=${parameters.p}$${encode(salt)}$${encode(derivedKey)}`;
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  try {
    const parts = encodedHash.split('$');
    if (parts.length !== 5 || parts[0] !== '' || parts[1] !== ALGORITHM) return false;
    const parameters = parseParameters(parts[2]);
    if (!parameters) return false;
    const salt = decode(parts[3]);
    const expected = decode(parts[4]);
    if (salt.length < 16 || expected.length !== KEY_LENGTH) return false;
    const actual = await scrypt(password, salt, parameters);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function passwordHashNeedsUpgrade(encodedHash: string): boolean {
  const parts = encodedHash.split('$');
  if (parts.length !== 5 || parts[1] !== ALGORITHM) return true;
  const parameters = parseParameters(parts[2]);
  return !parameters
    || parameters.logN !== DEFAULT_LOG_N
    || parameters.r !== DEFAULT_R
    || parameters.p !== DEFAULT_P;
}
