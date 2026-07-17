export class PublicGitHubUrlError extends Error {
  constructor(public readonly code: 'INVALID_REPOSITORY_URL') {
    super(code);
    this.name = 'PublicGitHubUrlError';
  }
}

export interface PublicGitHubRepositoryReference {
  owner: string;
  repository: string;
  fullName: string;
  canonicalUrl: string;
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPOSITORY = /^[A-Za-z0-9._-]{1,100}$/;
const PUBLIC_REPOSITORY_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/i;

export function normalizePublicGitHubRepositoryUrl(value: string): PublicGitHubRepositoryReference {
  if (!value
    || value.length > 300
    || /[\u0000-\u001f\u007f]/.test(value)
    || value !== value.trim()) {
    throw new PublicGitHubUrlError('INVALID_REPOSITORY_URL');
  }
  const match = PUBLIC_REPOSITORY_URL.exec(value);
  if (!match) {
    throw new PublicGitHubUrlError('INVALID_REPOSITORY_URL');
  }
  const owner = match[1];
  const rawRepository = match[2];
  const repository = rawRepository.endsWith('.git') ? rawRepository.slice(0, -4) : rawRepository;
  if (!OWNER.test(owner)
    || !REPOSITORY.test(repository)
    || repository === '.'
    || repository === '..') {
    throw new PublicGitHubUrlError('INVALID_REPOSITORY_URL');
  }
  return {
    owner,
    repository,
    fullName: `${owner}/${repository}`,
    canonicalUrl: `https://github.com/${owner}/${repository}`,
  };
}
