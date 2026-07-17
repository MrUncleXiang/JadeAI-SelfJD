import { NextResponse } from 'next/server';
import type { ZodType } from 'zod/v4';

import { authErrorResponse } from '@/lib/auth/api';

import { JdServiceError } from './service';

const MAX_JD_JSON_BYTES = 140 * 1024;

function dateString(value: Date | number | string | null): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date
    ? value
    : new Date(typeof value === 'number' && value < 10_000_000_000 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function readJdJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new JdServiceError('UNSUPPORTED_MEDIA_TYPE', 415, 'Content-Type must be application/json.');
  }
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_JD_JSON_BYTES) {
    throw new JdServiceError('PAYLOAD_TOO_LARGE', 413, 'Job description request is too large.');
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_JD_JSON_BYTES) {
    throw new JdServiceError('PAYLOAD_TOO_LARGE', 413, 'Job description request is too large.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new JdServiceError('INVALID_JSON', 400, 'Request body must be valid JSON.');
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new JdServiceError('INVALID_INPUT', 400, 'Job description request is invalid.');
  }
  return result.data;
}

export function toJdSource(source: Record<string, unknown>) {
  const requirements = Array.isArray(source.requirements)
    ? source.requirements as Array<Record<string, unknown>>
    : [];
  return {
    id: source.id,
    inputType: source.inputType,
    title: source.title,
    company: source.company,
    jobTitle: source.jobTitle,
    location: source.location,
    originalFilename: source.originalFilename,
    mimeType: source.mimeType,
    sizeBytes: source.sizeBytes,
    contentHash: source.contentHash,
    normalizedText: source.normalizedText,
    status: source.status,
    parserId: source.parserId,
    parserVersion: source.parserVersion,
    errorCode: source.errorCode,
    confirmedAt: dateString(source.confirmedAt as Date | number | string | null),
    createdAt: dateString(source.createdAt as Date | number | string | null),
    updatedAt: dateString(source.updatedAt as Date | number | string | null),
    requirements: requirements.map((requirement) => ({
      id: requirement.id,
      requirementType: requirement.requirementType,
      text: requirement.text,
      normalizedTerm: requirement.normalizedTerm,
      aliases: requirement.aliases,
      priority: requirement.priority,
      importance: requirement.importance,
      sourceLocator: requirement.sourceLocator,
      sortOrder: requirement.sortOrder,
    })),
  };
}

export function jdErrorResponse(error: unknown, requestId: string): NextResponse {
  if (!(error instanceof JdServiceError)) return authErrorResponse(error, requestId);
  const response = NextResponse.json({
    code: error.code,
    message: error.message,
    requestId,
  }, { status: error.status });
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

export function jdJson(body: unknown, requestId: string, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}
