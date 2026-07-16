import { describe, expect, it } from 'vitest';

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  hashPassword,
  passwordHashNeedsUpgrade,
  validatePassword,
  verifyPassword,
} from './password';

describe('password hashing', () => {
  it('hashes with a unique salt and verifies only the correct password', async () => {
    const password = 'correct horse battery staple';
    const first = await hashPassword(password);
    const second = await hashPassword(password);

    expect(first).toMatch(/^\$scrypt\$ln=15,r=8,p=1\$/);
    expect(second).not.toBe(first);
    await expect(verifyPassword(password, first)).resolves.toBe(true);
    await expect(verifyPassword('incorrect password', first)).resolves.toBe(false);
    expect(passwordHashNeedsUpgrade(first)).toBe(false);
  });

  it('rejects malformed or out-of-policy hashes without throwing', async () => {
    await expect(verifyPassword('anything', 'not-a-password-hash')).resolves.toBe(false);
    expect(passwordHashNeedsUpgrade('not-a-password-hash')).toBe(true);
    expect(passwordHashNeedsUpgrade('$scrypt$ln=14,r=8,p=1$AA$AA')).toBe(true);
  });

  it('enforces Unicode character and byte limits', () => {
    expect(validatePassword('x'.repeat(PASSWORD_MIN_LENGTH - 1))).not.toBeNull();
    expect(validatePassword('x'.repeat(PASSWORD_MIN_LENGTH))).toBeNull();
    expect(validatePassword('x'.repeat(PASSWORD_MAX_LENGTH + 1))).not.toBeNull();
    expect(validatePassword('😀'.repeat(PASSWORD_MAX_LENGTH))).toBeNull();
    expect(validatePassword('😀'.repeat(PASSWORD_MAX_LENGTH + 1))).not.toBeNull();
  });
});
