import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstat,
  readdir,
  readFile,
  realpath,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { careerFactContentHash, normalizeCareerText } from './normalize';
import type {
  CareerFactClaimInput,
  CareerFactImportInput,
  CareerSnapshotImportInput,
  SourceDocumentImportInput,
} from './types';
import { contentHash } from '@/lib/resume-patch/snapshot';

export const WORKRESUME_PARSER_ID = 'workresume-v2';
export const WORKRESUME_PARSER_VERSION = '1';
export const WORKRESUME_PARSER_LABEL = `${WORKRESUME_PARSER_ID}@${WORKRESUME_PARSER_VERSION}`;

const execFileAsync = promisify(execFile);
const CONFIG_FILE = 'WorkResume.config.json';
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const MAX_DOCUMENTS = 500;
const ALLOWED_EXTENSIONS = new Set(['.json', '.md', '.txt']);
const SECRET_NAME = /(^|[._-])(\.env|id_rsa|id_ed25519|credentials?|secrets?|private[_-]?key)([._-]|$)/i;

type JsonRecord = Record<string, unknown>;

interface CapabilityProjectEvidence {
  project: string;
  strength: string;
  ownership: string;
  claim: string;
  evidenceRefs: string[];
}

interface CapabilityTerm {
  id: string;
  canonicalName: string;
  chineseName: string;
  category: string;
  aliases: string[];
  projectEvidence: CapabilityProjectEvidence[];
  allowedClaims: string[];
  forbiddenClaims: string[];
  interviewAngles: string[];
  lastVerified: string;
}

export interface ParsedWorkResumeV2 {
  parserId: typeof WORKRESUME_PARSER_ID;
  parserVersion: typeof WORKRESUME_PARSER_VERSION;
  documents: SourceDocumentImportInput[];
  facts: CareerFactImportInput[];
  aggregateHash: string;
  warnings: string[];
}

export interface WorkResumeGitMetadata {
  commitSha: string;
  treeSha: string;
  defaultBranch: string;
  externalRepositoryId: string;
  displayName: string;
}

export class WorkResumeImportError extends Error {
  constructor(public readonly code:
    | 'ROOT_NOT_FOUND'
    | 'CONFIG_NOT_FOUND'
    | 'INVALID_CONFIG'
    | 'INVALID_CAPABILITY_POOL'
    | 'UNSAFE_PATH'
    | 'SYMLINK_NOT_ALLOWED'
    | 'SECRET_FILE_BLOCKED'
    | 'UNSUPPORTED_FILE'
    | 'FILE_TOO_LARGE'
    | 'IMPORT_TOO_LARGE'
    | 'TOO_MANY_DOCUMENTS'
    | 'BINARY_FILE_BLOCKED'
    | 'GIT_METADATA_UNAVAILABLE'
    | 'DOCUMENT_NOT_TRACKED'
    | 'WORKTREE_DIRTY'
  ) {
    super(code);
    this.name = 'WorkResumeImportError';
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, code: WorkResumeImportError['code']): string {
  if (typeof value !== 'string' || !normalizeCareerText(value)) throw new WorkResumeImportError(code);
  return normalizeCareerText(value);
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? normalizeCareerText(value) : '';
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => {
    const normalized = optionalString(item);
    return normalized ? [normalized] : [];
  }))];
}

function normalizeRelativePath(value: string): string {
  if (!value || value.includes('\0') || path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) {
    throw new WorkResumeImportError('UNSAFE_PATH');
  }
  const slashPath = value.replaceAll('\\', '/');
  const normalized = path.posix.normalize(slashPath);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new WorkResumeImportError('UNSAFE_PATH');
  }
  return normalized.replace(/^\.\//, '');
}

function sha256Text(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function mimeTypeFor(relativePath: string): string {
  switch (path.posix.extname(relativePath).toLowerCase()) {
    case '.json': return 'application/json';
    case '.md': return 'text/markdown';
    default: return 'text/plain';
  }
}

async function assertNoSymlink(root: string, relativePath: string) {
  let current = root;
  for (const segment of relativePath.split('/')) {
    current = path.join(current, segment);
    const info = await lstat(current).catch(() => null);
    if (!info) throw new WorkResumeImportError('CONFIG_NOT_FOUND');
    if (info.isSymbolicLink()) throw new WorkResumeImportError('SYMLINK_NOT_ALLOWED');
  }
}

async function listTextFiles(root: string, relativeDirectory: string): Promise<string[]> {
  const directory = normalizeRelativePath(relativeDirectory);
  await assertNoSymlink(root, directory);
  const info = await stat(path.join(root, directory)).catch(() => null);
  if (!info?.isDirectory()) throw new WorkResumeImportError('INVALID_CONFIG');
  const results: string[] = [];
  const visit = async (relative: string) => {
    const entries = await readdir(path.join(root, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new WorkResumeImportError('SYMLINK_NOT_ALLOWED');
      if (SECRET_NAME.test(entry.name)) throw new WorkResumeImportError('SECRET_FILE_BLOCKED');
      if (entry.isDirectory()) {
        await visit(child);
        continue;
      }
      if (!entry.isFile()) continue;
      if (ALLOWED_EXTENSIONS.has(path.posix.extname(child).toLowerCase())) results.push(child);
    }
  };
  await visit(directory);
  return results;
}

async function readSafeDocument(root: string, relativeValue: string): Promise<SourceDocumentImportInput> {
  const relativePath = normalizeRelativePath(relativeValue);
  if (SECRET_NAME.test(path.posix.basename(relativePath))) {
    throw new WorkResumeImportError('SECRET_FILE_BLOCKED');
  }
  const extension = path.posix.extname(relativePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) throw new WorkResumeImportError('UNSUPPORTED_FILE');
  await assertNoSymlink(root, relativePath);
  const absolutePath = path.join(root, ...relativePath.split('/'));
  const info = await stat(absolutePath).catch(() => null);
  if (!info?.isFile()) throw new WorkResumeImportError('CONFIG_NOT_FOUND');
  if (info.size > MAX_FILE_BYTES) throw new WorkResumeImportError('FILE_TOO_LARGE');
  const bytes = await readFile(absolutePath);
  if (bytes.includes(0)) throw new WorkResumeImportError('BINARY_FILE_BLOCKED');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n/g, '\n');
  } catch {
    throw new WorkResumeImportError('BINARY_FILE_BLOCKED');
  }
  return {
    path: relativePath,
    contentHash: sha256Text(text),
    mimeType: mimeTypeFor(relativePath),
    sizeBytes: Buffer.byteLength(text, 'utf8'),
    textContent: text,
    parseStatus: 'ready',
  };
}

function parseJsonDocument(document: SourceDocumentImportInput, code: WorkResumeImportError['code']): JsonRecord {
  try {
    const parsed = JSON.parse(document.textContent || '');
    if (!isRecord(parsed)) throw new Error('not object');
    return parsed;
  } catch {
    throw new WorkResumeImportError(code);
  }
}

function parseCapabilityTerm(value: unknown): CapabilityTerm {
  if (!isRecord(value)) throw new WorkResumeImportError('INVALID_CAPABILITY_POOL');
  const projectEvidence = Array.isArray(value.projectEvidence)
    ? value.projectEvidence.map((item) => {
      if (!isRecord(item)) throw new WorkResumeImportError('INVALID_CAPABILITY_POOL');
      return {
        project: requiredString(item.project, 'INVALID_CAPABILITY_POOL'),
        strength: optionalString(item.strength) || 'unknown',
        ownership: optionalString(item.ownership),
        claim: optionalString(item.claim),
        evidenceRefs: stringArray(item.evidenceRefs),
      };
    })
    : [];
  return {
    id: requiredString(value.id, 'INVALID_CAPABILITY_POOL'),
    canonicalName: requiredString(value.canonicalName, 'INVALID_CAPABILITY_POOL'),
    chineseName: optionalString(value.chineseName),
    category: optionalString(value.category) || 'uncategorized',
    aliases: stringArray(value.aliases),
    projectEvidence,
    allowedClaims: stringArray(value.allowedClaims),
    forbiddenClaims: stringArray(value.forbiddenClaims),
    interviewAngles: stringArray(value.interviewAngles),
    lastVerified: optionalString(value.lastVerified),
  };
}

function strengthConfidence(value: string): number {
  switch (value.toLocaleLowerCase('en-US')) {
    case 'strong': return 0.95;
    case 'medium': return 0.8;
    case 'adjacent': return 0.55;
    case 'rejected': return 0.2;
    default: return 0.65;
  }
}

function uniqueClaims(type: CareerFactClaimInput['type'], values: string[]): CareerFactClaimInput[] {
  return [...new Set(values.map(normalizeCareerText).filter(Boolean))].map((claim) => ({ type, claim }));
}

function buildFacts(capabilityPath: string, terms: CapabilityTerm[]) {
  const skillFacts: CareerFactImportInput[] = terms.map((term, termIndex) => {
    const title = term.chineseName || term.canonicalName;
    const summary = term.allowedClaims[0] || term.canonicalName;
    const structuredData = {
      capabilityId: term.id,
      canonicalName: term.canonicalName,
      chineseName: term.chineseName,
      category: term.category,
      aliases: term.aliases,
      projectEvidence: term.projectEvidence,
      interviewAngles: term.interviewAngles,
      lastVerified: term.lastVerified,
    };
    const canonicalKey = `skill:${term.id}`;
    const termHash = contentHash(term);
    return {
      factType: 'skill',
      canonicalKey,
      title,
      summary,
      structuredData,
      confidence: Math.max(0.5, ...term.projectEvidence.map((item) => strengthConfidence(item.strength))),
      contentHash: careerFactContentHash({ factType: 'skill', canonicalKey, title, summary, structuredData }),
      evidence: [{
        documentPath: capabilityPath,
        locator: `/terms/${termIndex}`,
        contentHash: termHash,
        excerptHash: termHash,
        summary: `Capability term ${term.id}`,
      }],
      claims: [
        ...uniqueClaims('allowed', term.allowedClaims),
        ...uniqueClaims('forbidden', term.forbiddenClaims),
      ],
    };
  });

  const projects = new Map<string, Array<{ term: CapabilityTerm; termIndex: number; evidence: CapabilityProjectEvidence; evidenceIndex: number }>>();
  terms.forEach((term, termIndex) => {
    term.projectEvidence.forEach((evidence, evidenceIndex) => {
      const list = projects.get(evidence.project) || [];
      list.push({ term, termIndex, evidence, evidenceIndex });
      projects.set(evidence.project, list);
    });
  });
  const projectFacts: CareerFactImportInput[] = [...projects.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([project, entries]) => {
      const allowed = entries.flatMap(({ evidence }) => (
        ['strong', 'medium'].includes(evidence.strength.toLocaleLowerCase('en-US')) && evidence.claim
          ? [evidence.claim]
          : []
      ));
      const forbidden = entries.flatMap(({ term }) => term.forbiddenClaims);
      const summary = allowed[0] || `Evidence-backed project: ${project}`;
      const structuredData = {
        project,
        capabilities: entries.map(({ term, evidence }) => ({
          capabilityId: term.id,
          canonicalName: term.canonicalName,
          strength: evidence.strength,
          ownership: evidence.ownership,
          claim: evidence.claim,
          evidenceRefs: evidence.evidenceRefs,
        })),
        evidenceRefs: [...new Set(entries.flatMap(({ evidence }) => evidence.evidenceRefs))],
      };
      const canonicalKey = `project:${sha256Text(project).slice('sha256:'.length, 31)}`;
      return {
        factType: 'project',
        canonicalKey,
        title: project,
        summary,
        structuredData,
        confidence: entries.reduce((sum, { evidence }) => sum + strengthConfidence(evidence.strength), 0) / entries.length,
        contentHash: careerFactContentHash({ factType: 'project', canonicalKey, title: project, summary, structuredData }),
        evidence: entries.map(({ termIndex, evidenceIndex, evidence }) => {
          const evidenceHash = contentHash(evidence);
          return {
            documentPath: capabilityPath,
            locator: `/terms/${termIndex}/projectEvidence/${evidenceIndex}`,
            contentHash: evidenceHash,
            excerptHash: evidenceHash,
            summary: `Project evidence (${evidence.strength})`,
          };
        }),
        claims: [
          ...uniqueClaims('allowed', allowed),
          ...uniqueClaims('forbidden', forbidden),
        ],
      };
    });
  return [...skillFacts, ...projectFacts];
}

export async function parseWorkResumeV2(rootValue: string): Promise<ParsedWorkResumeV2> {
  const root = await realpath(rootValue).catch(() => null);
  if (!root) throw new WorkResumeImportError('ROOT_NOT_FOUND');
  const rootInfo = await stat(root).catch(() => null);
  if (!rootInfo?.isDirectory()) throw new WorkResumeImportError('ROOT_NOT_FOUND');

  const documentPaths = new Set<string>([CONFIG_FILE]);
  const configDocument = await readSafeDocument(root, CONFIG_FILE)
    .catch((error) => {
      if (error instanceof WorkResumeImportError && error.code === 'CONFIG_NOT_FOUND') {
        throw new WorkResumeImportError('CONFIG_NOT_FOUND');
      }
      throw error;
    });
  const config = parseJsonDocument(configDocument, 'INVALID_CONFIG');
  if (config.schemaVersion !== 2 || !isRecord(config.paths)) {
    throw new WorkResumeImportError('INVALID_CONFIG');
  }
  const paths = config.paths;
  const capabilityPath = normalizeRelativePath(requiredString(paths.capabilityPool, 'INVALID_CONFIG'));
  documentPaths.add(capabilityPath);
  for (const key of ['jdTermPool', 'jdMapping', 'jdMappingView'] as const) {
    if (typeof paths[key] === 'string' && paths[key]) documentPaths.add(normalizeRelativePath(paths[key]));
  }
  for (const key of ['projectEvidenceDirectory', 'positioningDirectory'] as const) {
    if (typeof paths[key] !== 'string' || !paths[key]) continue;
    const listed = await listTextFiles(root, paths[key]);
    listed.forEach((item) => documentPaths.add(item));
  }
  if (documentPaths.size > MAX_DOCUMENTS) throw new WorkResumeImportError('TOO_MANY_DOCUMENTS');

  const documents: SourceDocumentImportInput[] = [];
  let totalBytes = 0;
  for (const relativePath of [...documentPaths].sort()) {
    const document = relativePath === CONFIG_FILE
      ? configDocument
      : await readSafeDocument(root, relativePath);
    totalBytes += document.sizeBytes;
    if (totalBytes > MAX_TOTAL_BYTES) throw new WorkResumeImportError('IMPORT_TOO_LARGE');
    documents.push(document);
  }
  const capabilityDocument = documents.find((document) => document.path === capabilityPath);
  if (!capabilityDocument) throw new WorkResumeImportError('INVALID_CAPABILITY_POOL');
  const pool = parseJsonDocument(capabilityDocument, 'INVALID_CAPABILITY_POOL');
  if (pool.schemaVersion !== 1 || pool.poolType !== 'verified-capability-terms' || !Array.isArray(pool.terms)) {
    throw new WorkResumeImportError('INVALID_CAPABILITY_POOL');
  }
  const terms = pool.terms.map(parseCapabilityTerm);
  const ids = new Set<string>();
  for (const term of terms) {
    if (ids.has(term.id)) throw new WorkResumeImportError('INVALID_CAPABILITY_POOL');
    ids.add(term.id);
  }
  const facts = buildFacts(capabilityPath, terms);
  if (facts.some((fact) => fact.evidence.length === 0)) {
    throw new WorkResumeImportError('INVALID_CAPABILITY_POOL');
  }
  return {
    parserId: WORKRESUME_PARSER_ID,
    parserVersion: WORKRESUME_PARSER_VERSION,
    documents,
    facts,
    aggregateHash: contentHash({
      parser: WORKRESUME_PARSER_LABEL,
      documents: documents.map(({ path: documentPath, contentHash: hash }) => ({ path: documentPath, hash })),
      facts: facts.map((fact) => ({ canonicalKey: fact.canonicalKey, contentHash: fact.contentHash })),
    }),
    warnings: [],
  };
}

async function git(root: string, args: string[]) {
  try {
    const result = await execFileAsync('git', ['-C', root, ...args], {
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
    return result.stdout.trim();
  } catch {
    throw new WorkResumeImportError('GIT_METADATA_UNAVAILABLE');
  }
}

export async function readWorkResumeGitMetadata(
  rootValue: string,
  documentPaths: readonly string[] = [],
): Promise<WorkResumeGitMetadata> {
  const root = await realpath(rootValue).catch(() => null);
  if (!root) throw new WorkResumeImportError('ROOT_NOT_FOUND');
  const [commitSha, treeSha, branch, dirty, remote] = await Promise.all([
    git(root, ['rev-parse', '--verify', 'HEAD']),
    git(root, ['rev-parse', '--verify', 'HEAD^{tree}']),
    git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(root, ['status', '--porcelain=v1', '--untracked-files=all']),
    git(root, ['config', '--get', 'remote.origin.url']).catch(() => ''),
  ]);
  if (dirty) throw new WorkResumeImportError('WORKTREE_DIRTY');
  if (documentPaths.length > 0) {
    const normalizedPaths = [...new Set(documentPaths.map(normalizeRelativePath))];
    try {
      await git(root, ['ls-files', '--error-unmatch', '--', ...normalizedPaths]);
    } catch {
      throw new WorkResumeImportError('DOCUMENT_NOT_TRACKED');
    }
  }
  if (!/^[0-9a-f]{40,64}$/i.test(commitSha) || !/^[0-9a-f]{40,64}$/i.test(treeSha)) {
    throw new WorkResumeImportError('GIT_METADATA_UNAVAILABLE');
  }
  const identitySeed = remote || root;
  return {
    commitSha,
    treeSha,
    defaultBranch: branch && branch !== 'HEAD' ? branch : 'main',
    externalRepositoryId: sha256Text(identitySeed),
    displayName: path.basename(root),
  };
}

export function toCareerSnapshotImport(
  userId: string,
  parsed: ParsedWorkResumeV2,
  metadata: WorkResumeGitMetadata,
): CareerSnapshotImportInput {
  return {
    userId,
    repository: {
      sourceType: 'local-workresume',
      externalRepositoryId: metadata.externalRepositoryId,
      fullName: metadata.displayName,
      defaultBranch: metadata.defaultBranch,
    },
    commitSha: metadata.commitSha,
    treeSha: metadata.treeSha,
    parserId: parsed.parserId,
    parserVersion: parsed.parserVersion,
    documents: parsed.documents,
    facts: parsed.facts,
  };
}
