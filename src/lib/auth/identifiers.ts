import { z } from 'zod/v4';

const USERNAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._-]{2,31}$/u;
const emailSchema = z.string().email().max(254);

export interface NormalizedUsername {
  value: string;
  normalized: string;
}

export interface NormalizedEmail {
  value: string;
  normalized: string;
}

export function normalizeUsername(input: string): NormalizedUsername | null {
  const value = input.normalize('NFKC').trim();
  if (!USERNAME_PATTERN.test(value)) return null;
  return { value, normalized: value.toLocaleLowerCase('en-US') };
}

export function normalizeEmail(input: string | null | undefined): NormalizedEmail | null {
  if (!input) return null;
  const value = input.normalize('NFKC').trim();
  if (!emailSchema.safeParse(value).success) return null;
  return { value, normalized: value.toLocaleLowerCase('en-US') };
}

export function normalizeLoginIdentifier(input: string): string | null {
  const value = input.normalize('NFKC').trim();
  if (!value || value.length > 254) return null;
  return value.toLocaleLowerCase('en-US');
}
