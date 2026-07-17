import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
});

import type { ActorContext } from '@/lib/auth/service';
import { db, dbReady } from '@/lib/db';
import {
  auditEvents,
  careerFactEvidence,
  sourceDocuments,
  sourceRepositories,
  sourceSnapshots,
  users,
} from '@/lib/db/schema';

import {
  type PublicGitHubSourceApi,
  PublicGitHubSourceError,
  publicGitHubSourceService,
} from './public-source';
import type { GitHubTreeEntry } from './types';

const suffix = crypto.randomUUID();
const userId = `github-public-${suffix}`;
const otherUserId = `github-public-other-${suffix}`;
const fixtureRoot = path.resolve('tests/fixtures/workresume-v2');

interface Version {
  commitSha: string;
  treeSha: string;
  entries: GitHubTreeEntry[];
}

const blobs = new Map<string, Buffer>();
const versions = new Map<string, Version>();
let currentHead = 'a'.repeat(40);

function blobSha(bytes: Buffer): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

async function fixtureFiles(directory = fixtureRoot, prefix = ''): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      for (const [child, bytes] of await fixtureFiles(path.join(directory, entry.name), relative)) {
        files.set(child, bytes);
      }
    } else if (entry.isFile()) {
      files.set(relative, await readFile(path.join(directory, entry.name)));
    }
  }
  return files;
}

function addVersion(commitSha: string, treeSha: string, files: Map<string, Buffer>) {
  const entries = [...files.entries()].map(([filePath, bytes]) => {
    const sha = blobSha(bytes);
    blobs.set(sha, bytes);
    return { path: filePath, mode: '100644', type: 'blob' as const, sha, size: bytes.length };
  });
  entries.push({ path: '.env', mode: '100644', type: 'blob', sha: 'f'.repeat(40), size: 32 });
  versions.set(commitSha, { commitSha, treeSha, entries });
}

const getBlob = vi.fn<PublicGitHubSourceApi['getBlob']>(async (_fullName, sha) => {
  const bytes = blobs.get(sha);
  if (!bytes) throw new Error(`unexpected blob ${sha}`);
  return { sha, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') };
});

const client: PublicGitHubSourceApi = {
  getRepository: vi.fn().mockResolvedValue({
    id: '92001',
    nodeId: 'R_92001',
    name: 'career-facts',
    fullName: 'alice/career-facts',
    private: false,
    defaultBranch: 'main',
    archived: false,
    disabled: false,
  }),
  getCommit: vi.fn(async () => {
    const version = versions.get(currentHead);
    if (!version) throw new Error(`unexpected commit ${currentHead}`);
    return { sha: version.commitSha, treeSha: version.treeSha };
  }),
  getTree: vi.fn(async (_fullName, treeSha) => {
    const version = [...versions.values()].find((candidate) => candidate.treeSha === treeSha);
    if (!version) throw new Error(`unexpected tree ${treeSha}`);
    return { sha: version.treeSha, truncated: false, entries: version.entries };
  }),
  getBlob,
};

function actor(id = userId): ActorContext {
  return {
    userId: id,
    role: 'user',
    sessionId: `session-${id}`,
    requestId: `request-${id}`,
    user: {
      id,
      username: id,
      email: null,
      name: null,
      avatarUrl: null,
      role: 'user',
      status: 'active',
      authType: 'password',
    },
  };
}

beforeAll(async () => {
  await dbReady;
  await db.insert(users).values([
    { id: userId, username: userId, authType: 'password' },
    { id: otherUserId, username: otherUserId, authType: 'password' },
  ]);
  const first = await fixtureFiles();
  addVersion('a'.repeat(40), '1'.repeat(40), first);
  const second = new Map(first);
  second.set('00_positioning/capabilities.json', Buffer.concat([
    second.get('00_positioning/capabilities.json')!,
    Buffer.from('\n'),
  ]));
  addVersion('b'.repeat(40), '2'.repeat(40), second);
  const secret = new Map(second);
  const capabilityPool = JSON.parse(secret.get('00_positioning/capabilities.json')!.toString('utf8'));
  capabilityPool.api_key = 'not-a-real-public-source-secret-12345';
  secret.set(
    '00_positioning/capabilities.json',
    Buffer.from(JSON.stringify(capabilityPool, null, 2)),
  );
  addVersion('c'.repeat(40), '3'.repeat(40), secret);
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('public GitHub source import', () => {
  it('imports a public repository through the common safe parsing pipeline', async () => {
    currentHead = 'a'.repeat(40);
    const result = await publicGitHubSourceService.importRepository(
      actor(),
      'https://github.com/alice/career-facts',
      { client },
    );
    expect(result).toMatchObject({
      alreadyImported: false,
      fetchedBlobs: 7,
      reusedBlobs: 0,
      ignoredDocuments: 1,
      documentsCreated: 8,
      factsCreated: 4,
      source: {
        kind: 'github-public',
        fullName: 'alice/career-facts',
        lastRevision: 'a'.repeat(40),
      },
    });
    expect(getBlob).toHaveBeenCalledTimes(7);
    expect(getBlob.mock.calls.some((call) => call[1] === 'f'.repeat(40))).toBe(false);
    await expect(publicGitHubSourceService.list(actor(otherUserId))).resolves.toEqual([]);
  });

  it('checks the default branch head and returns idempotently without reading the tree again', async () => {
    currentHead = 'a'.repeat(40);
    const result = await publicGitHubSourceService.importRepository(
      actor(),
      'https://github.com/alice/career-facts',
      { client },
    );
    expect(result).toMatchObject({ alreadyImported: true, fetchedBlobs: 0, documentsCreated: 0 });
    expect(client.getTree).not.toHaveBeenCalled();
    expect(getBlob).not.toHaveBeenCalled();
  });

  it('downloads only a changed blob and marks replaced evidence stale', async () => {
    currentHead = 'b'.repeat(40);
    const result = await publicGitHubSourceService.importRepository(
      actor(),
      'https://github.com/alice/career-facts',
      { client },
    );
    expect(result).toMatchObject({
      alreadyImported: false,
      fetchedBlobs: 1,
      reusedBlobs: 6,
      factsCreated: 0,
      factsReused: 4,
    });
    expect(result.evidenceMarkedStale).toBeGreaterThan(0);
    expect(getBlob).toHaveBeenCalledTimes(1);
    expect((await db.select().from(careerFactEvidence)).some(
      (evidence: typeof careerFactEvidence.$inferSelect) => evidence.stale,
    )).toBe(true);
  });

  it('rejects a required secret without persisting a new snapshot or plaintext', async () => {
    currentHead = 'c'.repeat(40);
    const snapshotCount = (await db.select().from(sourceSnapshots)).length;
    await expect(publicGitHubSourceService.importRepository(
      actor(),
      'https://github.com/alice/career-facts',
      { client },
    )).rejects.toEqual(expect.objectContaining<Partial<PublicGitHubSourceError>>({
      code: 'SECRET_DETECTED',
      status: 422,
    }));
    expect(await db.select().from(sourceSnapshots)).toHaveLength(snapshotCount);
    const persisted = JSON.stringify({
      documents: await db.select().from(sourceDocuments),
      audits: await db.select().from(auditEvents),
    });
    expect(persisted).not.toContain('not-a-real-public-source-secret-12345');
  });

  it('rejects ambiguous URLs and explicitly private metadata before content access', async () => {
    await expect(publicGitHubSourceService.importRepository(
      actor(),
      'https://github.com.evil.test/alice/career-facts',
      { client },
    )).rejects.toEqual(expect.objectContaining<Partial<PublicGitHubSourceError>>({
      code: 'INVALID_REPOSITORY_URL',
      status: 400,
    }));
    expect(client.getRepository).not.toHaveBeenCalled();

    vi.mocked(client.getRepository).mockResolvedValueOnce({
      id: 'private-1',
      nodeId: null,
      name: 'career-facts',
      fullName: 'alice/career-facts',
      private: true,
      defaultBranch: 'main',
      archived: false,
      disabled: false,
    });
    await expect(publicGitHubSourceService.importRepository(
      actor(),
      'https://github.com/alice/career-facts',
      { client },
    )).rejects.toEqual(expect.objectContaining<Partial<PublicGitHubSourceError>>({
      code: 'REPOSITORY_NOT_PUBLIC',
      status: 422,
    }));
    expect(client.getCommit).not.toHaveBeenCalled();
  });

  it('stores only the public source identity, never a source connection credential', async () => {
    const repositories = await db.select().from(sourceRepositories);
    expect(repositories).toContainEqual(expect.objectContaining({
      userId,
      sourceType: 'github-public',
      sourceConnectionId: null,
      externalRepositoryId: '92001',
    }));
  });
});
