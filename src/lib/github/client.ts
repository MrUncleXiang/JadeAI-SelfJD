import { createHash, timingSafeEqual } from 'node:crypto';

import type { GitHubAppConfig } from './config';
import { createGitHubAppJwt } from './jwt';
import type {
  GitHubBlob,
  GitHubCommit,
  GitHubInstallation,
  GitHubInstallationToken,
  GitHubRepository,
  GitHubTree,
  GitHubTreeEntry,
} from './types';

const API_VERSION = '2022-11-28';
const MAX_JSON_BYTES = 25 * 1024 * 1024;
const MAX_BLOB_RESPONSE_BYTES = 2 * 1024 * 1024;

type JsonRecord = Record<string, unknown>;

export class GitHubApiError extends Error {
  constructor(
    public readonly code:
      | 'AUTH_FAILED'
      | 'INSTALLATION_NOT_FOUND'
      | 'REPOSITORY_NOT_FOUND'
      | 'PERMISSION_DENIED'
      | 'RATE_LIMITED'
      | 'RESPONSE_TOO_LARGE'
      | 'INVALID_RESPONSE'
      | 'TREE_TRUNCATED'
      | 'NETWORK_ERROR',
    public readonly status: number,
    public readonly retryAt: Date | null = null,
  ) {
    super(code);
    this.name = 'GitHubApiError';
  }
}

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GitHubApiError('INVALID_RESPONSE', 502);
  }
  return value as JsonRecord;
}

function string(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new GitHubApiError('INVALID_RESPONSE', 502);
  return value;
}

function identifier(value: unknown): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).length === 0) {
    throw new GitHubApiError('INVALID_RESPONSE', 502);
  }
  return String(value);
}

function accountType(value: unknown): 'user' | 'organization' {
  if (value === 'User') return 'user';
  if (value === 'Organization') return 'organization';
  throw new GitHubApiError('INVALID_RESPONSE', 502);
}

function parsePermissions(value: unknown): Record<string, string> {
  const input = record(value || {});
  return Object.fromEntries(Object.entries(input).flatMap(([key, permission]) => (
    typeof permission === 'string' ? [[key, permission]] : []
  )));
}

export function hasRequiredReadOnlyGitHubPermissions(permissions: Record<string, string>): boolean {
  return permissions.contents === 'read'
    && permissions.metadata === 'read'
    && !Object.values(permissions).some((permission) => permission === 'write' || permission === 'admin');
}

function parseRepository(value: unknown): GitHubRepository {
  const item = record(value);
  return {
    id: identifier(item.id),
    nodeId: typeof item.node_id === 'string' ? item.node_id : null,
    name: string(item.name),
    fullName: string(item.full_name),
    private: Boolean(item.private),
    defaultBranch: string(item.default_branch),
    archived: Boolean(item.archived),
    disabled: Boolean(item.disabled),
  };
}

function repositoryPath(fullName: string): string {
  const segments = fullName.split('/');
  if (segments.length !== 2 || segments.some((segment) => !segment)) {
    throw new GitHubApiError('INVALID_RESPONSE', 502);
  }
  return `/repos/${segments.map(encodeURIComponent).join('/')}`;
}

function retryDate(response: Response): Date | null {
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) return new Date(reset * 1000);
  const after = Number(response.headers.get('retry-after'));
  if (Number.isFinite(after) && after >= 0) return new Date(Date.now() + after * 1000);
  return null;
}

async function boundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const announced = Number(response.headers.get('content-length'));
  if (Number.isFinite(announced) && announced > maxBytes) {
    throw new GitHubApiError('RESPONSE_TOO_LARGE', 502);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new GitHubApiError('RESPONSE_TOO_LARGE', 502);
  try {
    return bytes.length === 0 ? {} : JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new GitHubApiError('INVALID_RESPONSE', 502);
  }
}

export interface GitHubClientOptions {
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

export class GitHubAppClient {
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => Date;
  private readonly timeoutMs: number;

  constructor(private readonly config: GitHubAppConfig, options: GitHubClientOptions = {}) {
    this.fetchImplementation = options.fetch || fetch;
    this.now = options.now || (() => new Date());
    this.timeoutMs = options.timeoutMs || 15_000;
  }

  private async request(
    path: string,
    token: string,
    init: RequestInit = {},
    maxBytes = MAX_JSON_BYTES,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.config.apiBaseUrl}${path}`, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'JadeAI-Career',
          'X-GitHub-Api-Version': API_VERSION,
          ...init.headers,
        },
      });
    } catch (error) {
      if (error instanceof GitHubApiError) throw error;
      throw new GitHubApiError('NETWORK_ERROR', 502);
    }
    if (!response.ok) {
      if (response.status === 401) throw new GitHubApiError('AUTH_FAILED', 502);
      if (response.status === 404) {
        const installationRequest = path.startsWith('/app/installations/');
        throw new GitHubApiError(installationRequest ? 'INSTALLATION_NOT_FOUND' : 'REPOSITORY_NOT_FOUND', 404);
      }
      if (response.status === 429 || (
        response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0'
      )) {
        throw new GitHubApiError('RATE_LIMITED', 429, retryDate(response));
      }
      if (response.status === 403) throw new GitHubApiError('PERMISSION_DENIED', 403);
      throw new GitHubApiError('INVALID_RESPONSE', 502);
    }
    return boundedJson(response, maxBytes);
  }

  private appJwt(): string {
    return createGitHubAppJwt(this.config, this.now());
  }

  async getInstallation(installationId: string): Promise<GitHubInstallation> {
    const body = record(await this.request(
      `/app/installations/${encodeURIComponent(installationId)}`,
      this.appJwt(),
    ));
    const account = record(body.account);
    const selection = body.repository_selection;
    if (selection !== 'all' && selection !== 'selected') {
      throw new GitHubApiError('INVALID_RESPONSE', 502);
    }
    return {
      id: identifier(body.id),
      account: {
        id: identifier(account.id),
        login: string(account.login),
        type: accountType(account.type),
      },
      repositorySelection: selection,
      permissions: parsePermissions(body.permissions),
      suspendedAt: typeof body.suspended_at === 'string' ? body.suspended_at : null,
    };
  }

  async createInstallationToken(installationId: string): Promise<GitHubInstallationToken> {
    const body = record(await this.request(
      `/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
      this.appJwt(),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    ));
    return {
      token: string(body.token),
      expiresAt: string(body.expires_at),
      permissions: parsePermissions(body.permissions),
    };
  }

  async listInstallationRepositories(token: string): Promise<GitHubRepository[]> {
    const repositories: GitHubRepository[] = [];
    for (let page = 1; page <= 100; page++) {
      const body = record(await this.request(
        `/installation/repositories?per_page=100&page=${page}`,
        token,
      ));
      if (!Array.isArray(body.repositories)) throw new GitHubApiError('INVALID_RESPONSE', 502);
      const current = body.repositories.map(parseRepository);
      repositories.push(...current);
      if (current.length < 100) return repositories;
    }
    throw new GitHubApiError('RESPONSE_TOO_LARGE', 502);
  }

  async getRepository(token: string, repositoryId: string): Promise<GitHubRepository> {
    return parseRepository(await this.request(`/repositories/${encodeURIComponent(repositoryId)}`, token));
  }

  async getCommit(token: string, fullName: string, ref: string): Promise<GitHubCommit> {
    const body = record(await this.request(
      `${repositoryPath(fullName)}/commits/${encodeURIComponent(ref)}`,
      token,
    ));
    const commit = record(body.commit);
    const tree = record(commit.tree);
    return { sha: string(body.sha), treeSha: string(tree.sha) };
  }

  async getTree(token: string, fullName: string, treeSha: string): Promise<GitHubTree> {
    const body = record(await this.request(
      `${repositoryPath(fullName)}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`,
      token,
    ));
    if (!Array.isArray(body.tree)) throw new GitHubApiError('INVALID_RESPONSE', 502);
    const entries: GitHubTreeEntry[] = body.tree.map((value) => {
      const item = record(value);
      if (!['blob', 'tree', 'commit'].includes(String(item.type))) {
        throw new GitHubApiError('INVALID_RESPONSE', 502);
      }
      return {
        path: string(item.path),
        mode: string(item.mode),
        type: item.type as GitHubTreeEntry['type'],
        sha: string(item.sha),
        size: typeof item.size === 'number' && Number.isSafeInteger(item.size) ? item.size : null,
      };
    });
    const tree: GitHubTree = {
      sha: string(body.sha),
      truncated: body.truncated === true,
      entries,
    };
    if (tree.truncated) throw new GitHubApiError('TREE_TRUNCATED', 422);
    return tree;
  }

  async getBlob(token: string, fullName: string, blobSha: string): Promise<GitHubBlob> {
    const body = record(await this.request(
      `${repositoryPath(fullName)}/git/blobs/${encodeURIComponent(blobSha)}`,
      token,
      {},
      MAX_BLOB_RESPONSE_BYTES,
    ));
    if (body.encoding !== 'base64') throw new GitHubApiError('INVALID_RESPONSE', 502);
    const size = body.size;
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
      throw new GitHubApiError('INVALID_RESPONSE', 502);
    }
    return { sha: string(body.sha), size, encoding: 'base64', content: string(body.content) };
  }
}

export function decodeAndVerifyGitHubBlob(blob: GitHubBlob): Buffer {
  const encoded = blob.content.replace(/\s/g, '');
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new GitHubApiError('INVALID_RESPONSE', 502);
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length !== blob.size) throw new GitHubApiError('INVALID_RESPONSE', 502);
  const algorithm = blob.sha.length === 64 ? 'sha256' : blob.sha.length === 40 ? 'sha1' : null;
  if (!algorithm || !/^[0-9a-f]+$/i.test(blob.sha)) {
    throw new GitHubApiError('INVALID_RESPONSE', 502);
  }
  const actual = createHash(algorithm)
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest();
  const expected = Buffer.from(blob.sha, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new GitHubApiError('INVALID_RESPONSE', 502);
  }
  return bytes;
}
