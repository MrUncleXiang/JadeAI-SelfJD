import { NextResponse } from 'next/server';

import { authErrorResponse } from '@/lib/auth/api';

import { GitHubServiceError } from './service';
import { GitHubSyncError } from './sync';

const ERROR_MESSAGES: Record<string, string> = {
  GITHUB_NOT_CONFIGURED: 'GitHub App integration is not configured.',
  INVALID_RETURN_PATH: 'The return path is invalid.',
  INVALID_CONNECTION_STATE: 'The GitHub connection state is invalid or expired.',
  INSTALLATION_NOT_FOUND: 'The GitHub App installation was not found.',
  INSTALLATION_ALREADY_BOUND: 'This GitHub App installation is already bound to another user.',
  INSUFFICIENT_APP_PERMISSIONS: 'The GitHub App must use read-only Contents and Metadata permissions.',
  CONNECTION_NOT_FOUND: 'GitHub connection not found.',
  INVALID_REPOSITORY_SELECTION: 'Repository selection is invalid or no longer accessible.',
  GITHUB_UNAVAILABLE: 'GitHub is temporarily unavailable.',
  GITHUB_RATE_LIMITED: 'GitHub API rate limit reached.',
  REPOSITORY_NOT_FOUND: 'GitHub repository not found.',
  REPOSITORY_INACCESSIBLE: 'GitHub repository is inaccessible.',
  INSTALLATION_REVOKED: 'GitHub App installation was revoked.',
  REPOSITORY_TOO_LARGE: 'Repository exceeds the supported synchronization limits.',
  UNSUPPORTED_LAYOUT: 'Repository does not contain a supported WorkResume v2 layout.',
  SECRET_DETECTED: 'A required source document was blocked by the secret policy.',
  PARSER_VALIDATION_FAILED: 'Repository source validation failed.',
  SYNC_FAILED: 'GitHub synchronization failed.',
};

export function dateString(value: Date | number | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date
    ? value
    : new Date(typeof value === 'number' && value < 10_000_000_000 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function githubErrorResponse(error: unknown, requestId: string): NextResponse {
  if (!(error instanceof GitHubServiceError) && !(error instanceof GitHubSyncError)) {
    return authErrorResponse(error, requestId);
  }
  const response = NextResponse.json({
    code: error.code,
    message: ERROR_MESSAGES[error.code] || 'GitHub operation failed.',
    requestId,
  }, { status: error.status });
  if (error.retryAt) {
    response.headers.set('retry-after', String(Math.max(0, Math.ceil(
      (error.retryAt.getTime() - Date.now()) / 1000,
    ))));
  }
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

export function noStoreJson(body: unknown, requestId: string, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}
