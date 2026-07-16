export const CAREER_FACT_TYPES = [
  'profile',
  'employment',
  'project',
  'skill',
  'education',
  'certificate',
  'achievement',
] as const;

export const CAREER_FACT_STATUSES = ['draft', 'approved', 'rejected', 'superseded'] as const;

export type CareerFactType = typeof CAREER_FACT_TYPES[number];
export type CareerFactStatus = typeof CAREER_FACT_STATUSES[number];
export type CareerFactClaimType = 'allowed' | 'forbidden';

export interface CareerFactClaimInput {
  type: CareerFactClaimType;
  claim: string;
}

export interface CareerFactEvidenceInput {
  documentPath: string;
  locator: string;
  contentHash: string;
  excerptHash?: string | null;
  summary?: string;
}

export interface CareerFactImportInput {
  factType: CareerFactType;
  canonicalKey: string;
  title: string;
  summary: string;
  structuredData: Record<string, unknown>;
  confidence: number;
  contentHash: string;
  evidence: CareerFactEvidenceInput[];
  claims: CareerFactClaimInput[];
}

export interface SourceDocumentImportInput {
  path: string;
  blobSha?: string | null;
  contentHash: string;
  mimeType: string;
  sizeBytes: number;
  textContent?: string | null;
  parseStatus?: 'ready' | 'ignored' | 'failed';
}

export interface CareerSnapshotImportInput {
  userId: string;
  repository: {
    sourceType: 'local-workresume' | 'github';
    externalRepositoryId: string;
    fullName: string;
    defaultBranch: string;
  };
  commitSha: string;
  treeSha?: string | null;
  parserId: string;
  parserVersion: string;
  documents: SourceDocumentImportInput[];
  facts: CareerFactImportInput[];
}

export interface CareerFactPolicyItem {
  id: string;
  factType: CareerFactType;
  title: string;
  summary: string;
  structuredData: Record<string, unknown>;
  evidence: Array<{
    id: string;
    commitSha: string;
    path: string;
    locator: string;
    contentHash: string;
    summary: string;
  }>;
  allowedClaims: string[];
}

export interface CareerKnowledgePolicy {
  facts: CareerFactPolicyItem[];
  approvedEvidenceIds: ReadonlySet<string>;
  forbiddenClaims: string[];
}
