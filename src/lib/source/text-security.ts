import { createHash } from 'node:crypto';
import path from 'node:path';

import type { SourceDocumentImportInput } from '@/lib/career/types';

export const MAX_TEXT_DOCUMENT_BYTES = 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set(['.json', '.md', '.txt', '.yaml', '.yml']);
const IGNORED_DIRECTORY = /(^|\/)(?:\.git|\.next|\.cache|node_modules|vendor|dist|build|coverage|target|tmp|temp|cache)(?:\/|$)/i;
const SECRET_FILE = /(^|\/)(?:\.env(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|credentials?(?:\..*)?|secrets?(?:\..*)?|private[_-]?key(?:\..*)?|.*\.(?:pem|p12|pfx|key))$/i;

type SecurityFinding = NonNullable<SourceDocumentImportInput['securityFindings']>[number];

const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i],
  ['github_token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['aws_access_key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['api_token', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['credential_assignment', /\b(?:api[_-]?key|client[_-]?secret|password|access[_-]?token|private[_-]?key)\b["']?\s*[:=]\s*["']?[A-Za-z0-9_+\-/=.]{12,}/i],
];

const PROMPT_INJECTION_PATTERNS = [
  /ignore (?:all |any )?(?:previous|prior|above) (?:instructions?|prompts?)/i,
  /(?:reveal|print|return|show) (?:the )?(?:system|developer) (?:message|prompt)/i,
  /you are now (?:a|an|the) /i,
  /忽略(?:之前|以上|上面|先前)(?:的)?(?:所有)?(?:指令|提示|要求)/,
  /(?:泄露|输出|显示)(?:系统|开发者)(?:提示词|消息|指令)/,
  /你现在是(?:一个|一名)?/,
];

function finding(code: string, severity: SecurityFinding['severity'] = 'blocked'): SecurityFinding {
  return { code, severity };
}

export function normalizeTextSourcePath(value: string): string | null {
  if (!value || value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) return null;
  const slashNormalized = value.replaceAll('\\', '/');
  if (slashNormalized.split('/').some((segment) => segment === '..')) return null;
  const normalized = path.posix.normalize(slashNormalized);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    return null;
  }
  return normalized.replace(/^\.\//, '');
}

export function textDocumentMimeType(filePath: string): string {
  switch (path.posix.extname(filePath).toLowerCase()) {
    case '.json': return 'application/json';
    case '.md': return 'text/markdown';
    case '.yaml':
    case '.yml': return 'application/yaml';
    default: return 'text/plain';
  }
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export interface TextSourcePathClassification {
  path: string;
  accepted: boolean;
  findings: SecurityFinding[];
}

export function classifyTextSourcePath(
  filePath: string,
  size: number | null,
): TextSourcePathClassification {
  const normalized = normalizeTextSourcePath(filePath);
  if (!normalized) return { path: filePath, accepted: false, findings: [finding('unsafe_path')] };
  if (IGNORED_DIRECTORY.test(normalized)) {
    return { path: normalized, accepted: false, findings: [finding('ignored_directory', 'info')] };
  }
  if (SECRET_FILE.test(normalized)) {
    return { path: normalized, accepted: false, findings: [finding('secret_filename')] };
  }
  if (!ALLOWED_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase())) {
    return { path: normalized, accepted: false, findings: [finding('unsupported_extension', 'info')] };
  }
  if (size === null || size < 0 || size > MAX_TEXT_DOCUMENT_BYTES) {
    return { path: normalized, accepted: false, findings: [finding('file_too_large')] };
  }
  return { path: normalized, accepted: true, findings: [] };
}

export function inspectTextSourceDocument(input: {
  path: string;
  blobSha?: string | null;
  bytes: Buffer;
}): SourceDocumentImportInput {
  const classification = classifyTextSourcePath(input.path, input.bytes.length);
  const blobSha = input.blobSha || null;
  if (!classification.accepted) {
    return {
      path: classification.path,
      blobSha,
      contentHash: sha256(input.bytes),
      mimeType: 'application/octet-stream',
      sizeBytes: input.bytes.length,
      textContent: null,
      parseStatus: 'ignored',
      securityFindings: classification.findings,
      llmEligible: false,
    };
  }
  if (input.bytes.includes(0)) {
    return {
      path: classification.path,
      blobSha,
      contentHash: sha256(input.bytes),
      mimeType: textDocumentMimeType(classification.path),
      sizeBytes: input.bytes.length,
      textContent: null,
      parseStatus: 'ignored',
      securityFindings: [finding('binary_content')],
      llmEligible: false,
    };
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes).replace(/\r\n/g, '\n');
  } catch {
    return {
      path: classification.path,
      blobSha,
      contentHash: sha256(input.bytes),
      mimeType: textDocumentMimeType(classification.path),
      sizeBytes: input.bytes.length,
      textContent: null,
      parseStatus: 'ignored',
      securityFindings: [finding('invalid_utf8')],
      llmEligible: false,
    };
  }
  const findings: SecurityFinding[] = [];
  for (const [code, pattern] of SECRET_PATTERNS) {
    if (pattern.test(text)) findings.push(finding(code));
  }
  if (PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(text))) {
    findings.push(finding('prompt_injection'));
  }
  const blocked = findings.length > 0;
  const containsSecret = findings.some((item) => item.code !== 'prompt_injection');
  const contentHash = sha256(text);
  return {
    path: classification.path,
    blobSha: blobSha || contentHash,
    contentHash,
    mimeType: textDocumentMimeType(classification.path),
    sizeBytes: Buffer.byteLength(text, 'utf8'),
    textContent: containsSecret ? null : text,
    parseStatus: blocked ? 'ignored' : 'ready',
    securityFindings: findings,
    llmEligible: !blocked,
  };
}
