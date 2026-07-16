import { contentHash } from '@/lib/resume-patch/snapshot';

export function normalizeCareerText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function normalizeClaim(value: string): string {
  return normalizeCareerText(value).toLocaleLowerCase('en-US');
}

export function careerFactContentHash(input: {
  factType: string;
  canonicalKey: string;
  title: string;
  summary: string;
  structuredData: Record<string, unknown>;
}): string {
  return contentHash({
    factType: input.factType,
    canonicalKey: normalizeCareerText(input.canonicalKey),
    title: normalizeCareerText(input.title),
    summary: normalizeCareerText(input.summary),
    structuredData: input.structuredData,
  });
}

export function claimContentHash(type: string, claim: string): string {
  return contentHash({ type, claim: normalizeClaim(claim) });
}

export function safeJsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
