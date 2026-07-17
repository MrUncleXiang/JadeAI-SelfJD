export interface GitHubAppConfig {
  appId: string;
  appSlug: string;
  privateKey: string;
  webhookSecret: string;
  apiBaseUrl: string;
  webBaseUrl: string;
}

export class GitHubConfigError extends Error {
  constructor(public readonly code: 'MISSING_CONFIG' | 'INVALID_CONFIG', message: string) {
    super(message);
    this.name = 'GitHubConfigError';
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new GitHubConfigError('MISSING_CONFIG', `${name} is required`);
  return value;
}

function baseUrl(value: string, name: string, nodeEnv: string | undefined): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new GitHubConfigError('INVALID_CONFIG', `${name} must be an absolute URL`);
  }
  const testHttp = nodeEnv === 'test' && parsed.protocol === 'http:';
  if (parsed.protocol !== 'https:' && !testHttp) {
    throw new GitHubConfigError('INVALID_CONFIG', `${name} must use HTTPS`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new GitHubConfigError('INVALID_CONFIG', `${name} must not include credentials, query, or fragment`);
  }
  return parsed.toString().replace(/\/$/, '');
}

export function loadGitHubAppConfig(env: NodeJS.ProcessEnv = process.env): GitHubAppConfig {
  const appId = required(env, 'GITHUB_APP_ID');
  if (!/^[1-9]\d{0,29}$/.test(appId)) {
    throw new GitHubConfigError('INVALID_CONFIG', 'GITHUB_APP_ID must be a positive numeric identifier');
  }
  const appSlug = required(env, 'GITHUB_APP_SLUG');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/i.test(appSlug)) {
    throw new GitHubConfigError('INVALID_CONFIG', 'GITHUB_APP_SLUG is invalid');
  }
  const privateKey = required(env, 'GITHUB_APP_PRIVATE_KEY').replaceAll('\\n', '\n');
  if (!privateKey.includes('BEGIN') || !privateKey.includes('PRIVATE KEY')) {
    throw new GitHubConfigError('INVALID_CONFIG', 'GITHUB_APP_PRIVATE_KEY is not a PEM private key');
  }
  const webhookSecret = required(env, 'GITHUB_WEBHOOK_SECRET');
  if (webhookSecret.length < 16) {
    throw new GitHubConfigError('INVALID_CONFIG', 'GITHUB_WEBHOOK_SECRET must contain at least 16 characters');
  }
  return {
    appId,
    appSlug,
    privateKey,
    webhookSecret,
    apiBaseUrl: baseUrl(env.GITHUB_API_BASE_URL || 'https://api.github.com', 'GITHUB_API_BASE_URL', env.NODE_ENV),
    webBaseUrl: baseUrl(env.GITHUB_WEB_BASE_URL || 'https://github.com', 'GITHUB_WEB_BASE_URL', env.NODE_ENV),
  };
}

export function githubInstallationUrl(config: GitHubAppConfig, state: string): string {
  const url = new URL(`/apps/${encodeURIComponent(config.appSlug)}/installations/new`, `${config.webBaseUrl}/`);
  url.searchParams.set('state', state);
  return url.toString();
}
