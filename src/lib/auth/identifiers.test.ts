import { describe, expect, it } from 'vitest';

import { normalizeEmail, normalizeLoginIdentifier, normalizeUsername } from './identifiers';

describe('auth identifier normalization', () => {
  it('normalizes case and compatibility characters deterministically', () => {
    expect(normalizeUsername('  Ａlice.Dev  ')).toEqual({
      value: 'Alice.Dev',
      normalized: 'alice.dev',
    });
    expect(normalizeLoginIdentifier('  USER@Example.COM ')).toBe('user@example.com');
  });

  it('accepts international usernames while rejecting unsafe shapes', () => {
    expect(normalizeUsername('向量_01')).toMatchObject({ normalized: '向量_01' });
    expect(normalizeUsername('_alice')).toBeNull();
    expect(normalizeUsername('ab')).toBeNull();
    expect(normalizeUsername('alice/../../admin')).toBeNull();
  });

  it('validates and normalizes email addresses', () => {
    expect(normalizeEmail(' Alice@Example.COM ')).toEqual({
      value: 'Alice@Example.COM',
      normalized: 'alice@example.com',
    });
    expect(normalizeEmail('not-an-email')).toBeNull();
  });
});
