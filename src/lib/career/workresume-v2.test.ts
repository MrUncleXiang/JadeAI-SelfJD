import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import {
  parseWorkResumeV2,
  readWorkResumeGitMetadata,
  WorkResumeImportError,
} from './workresume-v2';

const fixture = path.resolve('tests/fixtures/workresume-v2');
const goldenPath = path.resolve('tests/fixtures/workresume-v2.golden.json');
const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function summarize(parsed: Awaited<ReturnType<typeof parseWorkResumeV2>>) {
  return {
    aggregateHash: parsed.aggregateHash,
    documentCount: parsed.documents.length,
    factCount: parsed.facts.length,
    facts: parsed.facts.map((fact) => ({
      canonicalKey: fact.canonicalKey,
      factType: fact.factType,
      title: fact.title,
      evidenceCount: fact.evidence.length,
      allowedClaims: fact.claims.filter((claim) => claim.type === 'allowed').length,
      forbiddenClaims: fact.claims.filter((claim) => claim.type === 'forbidden').length,
      contentHash: fact.contentHash,
    })),
  };
}

async function temporaryFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'jade-workresume-'));
  temporaryDirectories.push(directory);
  await cp(fixture, directory, { recursive: true });
  return directory;
}

async function git(root: string, ...args: string[]) {
  return execFileAsync('git', ['-C', root, ...args]);
}

async function commitFixture(root: string) {
  await git(root, 'init');
  await git(root, 'config', 'user.name', 'JadeAI Test');
  await git(root, 'config', 'user.email', 'jadeai@example.test');
  await git(root, 'add', '-A');
  await git(root, 'commit', '-m', 'fixture');
}

describe('WorkResume v2 parser', () => {
  it('matches the deterministic golden facts and evidence', async () => {
    const parsed = await parseWorkResumeV2(fixture);
    const golden = JSON.parse(await readFile(goldenPath, 'utf8'));
    expect(summarize(parsed)).toEqual(golden);
    expect(parsed.documents.every((document) => !path.isAbsolute(document.path))).toBe(true);
    expect(parsed.facts.every((fact) => fact.evidence.length > 0)).toBe(true);
  });

  it('rejects absolute and parent-traversal paths from repository configuration', async () => {
    for (const malicious of ['/tmp/capabilities.json', '../capabilities.json']) {
      const directory = await temporaryFixture();
      const configPath = path.join(directory, 'WorkResume.config.json');
      const config = JSON.parse(await readFile(configPath, 'utf8'));
      config.paths.capabilityPool = malicious;
      await writeFile(configPath, JSON.stringify(config));
      await expect(parseWorkResumeV2(directory)).rejects.toMatchObject({
        code: 'UNSAFE_PATH',
      } satisfies Partial<WorkResumeImportError>);
    }
  });

  it('rejects symlinks instead of following files outside the repository', async () => {
    const directory = await temporaryFixture();
    const target = path.join(directory, '00_positioning/capabilities.json');
    await rm(target);
    await symlink('/etc/hosts', target);
    await expect(parseWorkResumeV2(directory)).rejects.toMatchObject({
      code: 'SYMLINK_NOT_ALLOWED',
    } satisfies Partial<WorkResumeImportError>);
  });

  it('rejects invalid UTF-8 instead of decoding binary bytes with replacement characters', async () => {
    const directory = await temporaryFixture();
    await writeFile(path.join(directory, '00_positioning/invalid.txt'), Buffer.from([0xc3, 0x28]));
    await expect(parseWorkResumeV2(directory)).rejects.toMatchObject({
      code: 'BINARY_FILE_BLOCKED',
    } satisfies Partial<WorkResumeImportError>);
  });

  it('binds imported documents to a clean commit and rejects untracked worktree content', async () => {
    const directory = await temporaryFixture();
    await commitFixture(directory);
    const parsed = await parseWorkResumeV2(directory);
    const metadata = await readWorkResumeGitMetadata(
      directory,
      parsed.documents.map((document) => document.path),
    );
    expect(metadata.commitSha).toMatch(/^[0-9a-f]{40}$/);

    await writeFile(path.join(directory, 'untracked.txt'), 'not part of the immutable snapshot');
    await expect(readWorkResumeGitMetadata(directory, parsed.documents.map((document) => document.path)))
      .rejects.toMatchObject({ code: 'WORKTREE_DIRTY' } satisfies Partial<WorkResumeImportError>);
  });

  it('rejects an ignored source document that is not present in the claimed commit', async () => {
    const directory = await temporaryFixture();
    const configPath = path.join(directory, 'WorkResume.config.json');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    config.paths.jdMappingView = 'ignored.txt';
    await writeFile(configPath, JSON.stringify(config));
    await writeFile(path.join(directory, '.gitignore'), 'ignored.txt\n');
    await commitFixture(directory);
    await writeFile(path.join(directory, 'ignored.txt'), 'ignored source');

    const parsed = await parseWorkResumeV2(directory);
    await expect(readWorkResumeGitMetadata(directory, parsed.documents.map((document) => document.path)))
      .rejects.toMatchObject({ code: 'DOCUMENT_NOT_TRACKED' } satisfies Partial<WorkResumeImportError>);
  });
});
