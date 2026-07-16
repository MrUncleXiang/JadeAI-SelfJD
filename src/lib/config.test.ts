import { describe, expect, it } from 'vitest';

import { isAccountAuthEnabled } from './config';

describe('isAccountAuthEnabled', () => {
  it('enables account authentication by default', () => {
    expect(isAccountAuthEnabled(undefined, 'development')).toBe(true);
  });

  it('allows the legacy mode only when explicitly disabled outside production', () => {
    expect(isAccountAuthEnabled('false', 'development')).toBe(false);
    expect(isAccountAuthEnabled('false', 'test')).toBe(false);
  });

  it('fails closed in production', () => {
    expect(isAccountAuthEnabled('false', 'production')).toBe(true);
  });
});
