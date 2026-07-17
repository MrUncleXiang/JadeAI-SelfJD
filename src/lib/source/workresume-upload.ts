import type { CareerSnapshotImportInput, SourceDocumentImportInput } from '@/lib/career/types';
import {
  parseWorkResumeV2Documents,
  type ParsedWorkResumeV2,
  WorkResumeImportError,
} from '@/lib/career/workresume-v2';

import {
  inspectTextSourceDocument,
  normalizeTextSourcePath,
} from './text-security';

const CONFIG_FILE = 'WorkResume.config.json';

export const WORKRESUME_UPLOAD_SCHEMA_VERSION = '1';
export const WORKRESUME_UPLOAD_SOURCE_TYPE = 'uploaded-workresume' as const;
export const WORKRESUME_UPLOAD_EXTERNAL_ID = 'primary';
export const WORKRESUME_UPLOAD_MAX_FILES = 500;
export const WORKRESUME_UPLOAD_MAX_BYTES = 12 * 1024 * 1024;
export const WORKRESUME_UPLOAD_MAX_REQUEST_BYTES = 14 * 1024 * 1024;

export type WorkResumeUploadErrorCode =
  | 'INVALID_UPLOAD'
  | 'UNSAFE_PATH'
  | 'TOO_MANY_FILES'
  | 'PAYLOAD_TOO_LARGE'
  | 'SECRET_DETECTED'
  | 'UNSUPPORTED_LAYOUT'
  | 'PARSER_VALIDATION_FAILED';

export class WorkResumeUploadError extends Error {
  constructor(public readonly code: WorkResumeUploadErrorCode) {
    super(code);
    this.name = 'WorkResumeUploadError';
  }
}

export interface WorkResumeUploadEntry {
  path: string;
  bytes: Buffer;
}

export interface PreparedWorkResumeUpload {
  parsed: ParsedWorkResumeV2;
  revision: string;
  uploadedFiles: number;
  ignoredFiles: number;
  uploadedBytes: number;
}

function mapParserError(error: WorkResumeImportError): WorkResumeUploadError {
  switch (error.code) {
    case 'UNSAFE_PATH':
      return new WorkResumeUploadError('UNSAFE_PATH');
    case 'SECRET_FILE_BLOCKED':
      return new WorkResumeUploadError('SECRET_DETECTED');
    case 'FILE_TOO_LARGE':
    case 'IMPORT_TOO_LARGE':
    case 'TOO_MANY_DOCUMENTS':
      return new WorkResumeUploadError('PAYLOAD_TOO_LARGE');
    case 'CONFIG_NOT_FOUND':
    case 'INVALID_CONFIG':
      return new WorkResumeUploadError('UNSUPPORTED_LAYOUT');
    default:
      return new WorkResumeUploadError('PARSER_VALIDATION_FAILED');
  }
}

function stripBrowserRoot(paths: readonly string[]): { paths: string[]; prefix: string } {
  if (paths.includes(CONFIG_FILE)) return { paths: [...paths], prefix: '' };
  const candidates = paths.filter((candidate) => candidate.endsWith(`/${CONFIG_FILE}`));
  if (candidates.length !== 1) throw new WorkResumeUploadError('UNSUPPORTED_LAYOUT');
  const prefix = candidates[0].slice(0, -(`/${CONFIG_FILE}`.length));
  const rootPrefix = `${prefix}/`;
  if (!prefix || paths.some((candidate) => !candidate.startsWith(rootPrefix))) {
    throw new WorkResumeUploadError('UNSUPPORTED_LAYOUT');
  }
  return { paths: paths.map((candidate) => candidate.slice(rootPrefix.length)), prefix };
}

export function prepareWorkResumeUpload(
  entries: readonly WorkResumeUploadEntry[],
): PreparedWorkResumeUpload {
  if (entries.length === 0) throw new WorkResumeUploadError('INVALID_UPLOAD');
  if (entries.length > WORKRESUME_UPLOAD_MAX_FILES) {
    throw new WorkResumeUploadError('TOO_MANY_FILES');
  }
  const uploadedBytes = entries.reduce((sum, entry) => sum + entry.bytes.length, 0);
  if (uploadedBytes > WORKRESUME_UPLOAD_MAX_BYTES) {
    throw new WorkResumeUploadError('PAYLOAD_TOO_LARGE');
  }

  const normalizedPaths = entries.map((entry) => {
    const normalized = normalizeTextSourcePath(entry.path);
    if (!normalized) throw new WorkResumeUploadError('UNSAFE_PATH');
    return normalized;
  });
  const stripped = stripBrowserRoot(normalizedPaths);
  const seen = new Set<string>();
  const candidates: SourceDocumentImportInput[] = [];
  let ignoredFiles = 0;

  for (let index = 0; index < entries.length; index++) {
    const documentPath = stripped.paths[index];
    if (!documentPath || seen.has(documentPath)) {
      throw new WorkResumeUploadError('INVALID_UPLOAD');
    }
    seen.add(documentPath);
    const document = inspectTextSourceDocument({
      path: documentPath,
      bytes: entries[index].bytes,
    });
    const findingCodes = new Set(document.securityFindings?.map((item) => item.code) || []);
    if (findingCodes.has('unsafe_path')) throw new WorkResumeUploadError('UNSAFE_PATH');
    if (findingCodes.has('secret_filename')) throw new WorkResumeUploadError('SECRET_DETECTED');
    if (findingCodes.has('file_too_large')) throw new WorkResumeUploadError('PAYLOAD_TOO_LARGE');
    if (findingCodes.has('ignored_directory') || findingCodes.has('unsupported_extension')) {
      ignoredFiles++;
      continue;
    }
    candidates.push(document);
  }

  let parsed: ParsedWorkResumeV2;
  try {
    parsed = parseWorkResumeV2Documents(candidates);
  } catch (error) {
    if (error instanceof WorkResumeImportError) throw mapParserError(error);
    throw error;
  }
  const revision = parsed.aggregateHash.replace(/^sha256:/, '');
  return {
    parsed: {
      ...parsed,
      documents: parsed.documents.map((document) => ({
        ...document,
        blobSha: document.contentHash.replace(/^sha256:/, ''),
      })),
    },
    revision,
    uploadedFiles: entries.length,
    ignoredFiles,
    uploadedBytes,
  };
}

export function toUploadedCareerSnapshotImport(input: {
  userId: string;
  sourceName: string;
  prepared: PreparedWorkResumeUpload;
  parentSnapshotId?: string | null;
}): CareerSnapshotImportInput {
  return {
    userId: input.userId,
    repository: {
      sourceType: WORKRESUME_UPLOAD_SOURCE_TYPE,
      externalRepositoryId: WORKRESUME_UPLOAD_EXTERNAL_ID,
      fullName: input.sourceName,
      defaultBranch: 'upload',
    },
    commitSha: input.prepared.revision,
    treeSha: input.prepared.revision,
    parentSnapshotId: input.parentSnapshotId || null,
    parserId: input.prepared.parsed.parserId,
    parserVersion: input.prepared.parsed.parserVersion,
    documents: input.prepared.parsed.documents,
    facts: input.prepared.parsed.facts,
  };
}
