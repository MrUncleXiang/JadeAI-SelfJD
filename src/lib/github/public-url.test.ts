import { describe, expect, it } from 'vitest';

import { normalizePublicGitHubRepositoryUrl, PublicGitHubUrlError } from './public-url';

describe('public GitHub repository URL boundary', () => {
  it('normalizes a canonical repository URL without retaining transport suffixes', () => {
    expect(normalizePublicGitHubRepositoryUrl('https://github.com/Alice/career.facts.git/')).toEqual({
      owner: 'Alice',
      repository: 'career.facts',
      fullName: 'Alice/career.facts',
      canonicalUrl: 'https://github.com/Alice/career.facts',
    });
  });

  it.each([
    'http://github.com/alice/repo',
    'https://github.com.evil.test/alice/repo',
    'https://evil.test/github.com/alice/repo',
    'https://user:password@github.com/alice/repo',
    'https://github.com:443/alice/repo',
    'https://github.com/alice/repo/issues',
    'https://github.com/alice/repo?tab=readme',
    'https://github.com/alice/repo#readme',
    'https://github.com/alice/%2e%2e',
    'https://%67ithub.com/alice/repo',
    'https://github.com/alice/other/../repo',
    'https://github.com/alice\\repo',
    ' https://github.com/alice/repo',
    'https://git\nhub.com/alice/repo',
    'git@github.com:alice/repo.git',
  ])('rejects non-canonical or ambiguous input: %s', (value) => {
    expect(() => normalizePublicGitHubRepositoryUrl(value)).toThrowError(
      expect.objectContaining<Partial<PublicGitHubUrlError>>({ code: 'INVALID_REPOSITORY_URL' }),
    );
  });
});
