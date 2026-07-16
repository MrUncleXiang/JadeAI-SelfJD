import { NextResponse } from 'next/server';

import { authErrorResponse } from '@/lib/auth/api';

import { CareerServiceError } from './service';

function dateString(value: Date | number | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date
    ? value
    : new Date(typeof value === 'number' && value < 10_000_000_000 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function toCareerFact(fact: Record<string, unknown>) {
  const evidence = Array.isArray(fact.evidence) ? fact.evidence as Array<Record<string, unknown>> : [];
  const claims = Array.isArray(fact.claims) ? fact.claims as Array<Record<string, unknown>> : [];
  const reviewEvents = Array.isArray(fact.reviewEvents)
    ? fact.reviewEvents as Array<Record<string, unknown>>
    : [];
  return {
    id: fact.id,
    factType: fact.factType,
    canonicalKey: fact.canonicalKey,
    title: fact.title,
    summary: fact.summary,
    structuredData: fact.structuredData,
    status: fact.status,
    confidence: fact.confidence,
    contentHash: fact.contentHash,
    supersedesFactId: fact.supersedesFactId,
    supersededByFactId: fact.supersededByFactId,
    createdBy: fact.createdBy,
    approvedAt: dateString(fact.approvedAt as Date | number | string | null),
    createdAt: dateString(fact.createdAt as Date | number | string | null),
    updatedAt: dateString(fact.updatedAt as Date | number | string | null),
    evidence: evidence.map((item) => ({
      id: item.id,
      sourceDocumentId: item.sourceDocumentId,
      commitSha: item.commitSha,
      path: item.path,
      locator: item.locator,
      contentHash: item.contentHash,
      excerptHash: item.excerptHash,
      summary: item.summary,
      parserId: item.parserId,
      parserVersion: item.parserVersion,
      stale: item.stale,
    })),
    claims: claims.map((item) => ({
      id: item.id,
      type: item.claimType,
      claim: item.claim,
    })),
    reviewEvents: reviewEvents.map((item) => ({
      id: item.id,
      action: item.action,
      beforeState: item.beforeState,
      afterState: item.afterState,
      note: item.note,
      createdAt: dateString(item.createdAt as Date | number | string | null),
    })),
  };
}

export function careerErrorResponse(error: unknown, requestId: string): NextResponse {
  if (!(error instanceof CareerServiceError)) return authErrorResponse(error, requestId);
  const response = NextResponse.json({
    code: error.code,
    message: error.message,
    requestId,
  }, { status: error.status });
  response.headers.set('x-request-id', requestId);
  return response;
}
