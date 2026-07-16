import { NextResponse } from 'next/server';

import { authErrorResponse } from '@/lib/auth/api';
import type { llmProfiles } from '@/lib/db/schema';

import { LlmProfileServiceError, type LlmCapabilities } from './service';

type ProfileRecord = typeof llmProfiles.$inferSelect;

const ERROR_MESSAGES: Record<LlmProfileServiceError['code'], string> = {
  PROFILE_NOT_FOUND: 'LLM profile not found',
  INVALID_BASE_URL: 'BaseURL must be a valid HTTP or HTTPS URL without credentials, query, or fragment',
  BASE_URL_BLOCKED: 'BaseURL is blocked by the outbound network policy',
  BASE_URL_DNS_FAILED: 'BaseURL hostname could not be resolved safely',
  LLM_ENCRYPTION_UNAVAILABLE: 'LLM secret encryption is not configured correctly',
};

function dateString(value: Date | number | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date
    ? value
    : new Date(typeof value === 'number' && value < 10_000_000_000 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function capabilities(value: unknown): LlmCapabilities {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    reachable: record.reachable === true,
    json: record.json === true,
    tools: record.tools === true,
    vision: record.vision === true,
  };
}

export function toLlmProfile(profile: ProfileRecord) {
  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    modelName: profile.modelName,
    hasApiKey: Boolean(profile.encryptedApiKey),
    status: profile.status,
    capabilities: capabilities(profile.capabilities),
    lastTestedAt: dateString(profile.lastTestedAt),
    createdAt: dateString(profile.createdAt),
    updatedAt: dateString(profile.updatedAt),
  };
}

export function llmErrorResponse(error: unknown, requestId: string): NextResponse {
  if (!(error instanceof LlmProfileServiceError)) {
    return authErrorResponse(error, requestId);
  }
  const response = NextResponse.json({
    code: error.code,
    message: ERROR_MESSAGES[error.code],
    requestId,
  }, { status: error.status });
  response.headers.set('x-request-id', requestId);
  return response;
}
