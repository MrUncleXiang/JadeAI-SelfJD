import type { SourceDocumentImportInput } from '@/lib/career/types';
import {
  classifyTextSourcePath,
  inspectTextSourceDocument,
  MAX_TEXT_DOCUMENT_BYTES,
  textDocumentMimeType,
} from '@/lib/source/text-security';

import type { GitHubTreeEntry } from './types';

export const GITHUB_MAX_DOCUMENT_BYTES = MAX_TEXT_DOCUMENT_BYTES;
export const classifyGitHubPath = classifyTextSourcePath;
export const githubDocumentMimeType = textDocumentMimeType;

export interface GitHubPathClassification {
  path: string;
  accepted: boolean;
  findings: NonNullable<SourceDocumentImportInput['securityFindings']>;
}

export function filterGitHubTree(entries: readonly GitHubTreeEntry[]) {
  const accepted: Array<GitHubTreeEntry & { path: string }> = [];
  const ignored: SourceDocumentImportInput[] = [];
  for (const entry of entries) {
    if (entry.type !== 'blob') continue;
    const result = classifyGitHubPath(entry.path, entry.size);
    if (result.accepted) {
      accepted.push({ ...entry, path: result.path });
      continue;
    }
    ignored.push({
      path: result.path,
      blobSha: entry.sha,
      contentHash: `git:${entry.sha}`,
      mimeType: 'application/octet-stream',
      sizeBytes: Math.max(0, entry.size || 0),
      textContent: null,
      parseStatus: 'ignored',
      securityFindings: result.findings,
      llmEligible: false,
    });
  }
  accepted.sort((a, b) => a.path.localeCompare(b.path));
  ignored.sort((a, b) => a.path.localeCompare(b.path));
  return { accepted, ignored };
}

export function inspectGitHubDocument(input: {
  path: string;
  blobSha: string;
  bytes: Buffer;
}): SourceDocumentImportInput {
  return inspectTextSourceDocument(input);
}
