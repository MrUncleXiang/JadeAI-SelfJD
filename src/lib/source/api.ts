import { NextResponse } from 'next/server';

import { authErrorResponse } from '@/lib/auth/api';

import { WorkResumeUploadServiceError } from './workresume-upload-service';

export class WorkResumeUploadRequestError extends Error {
  constructor(
    public readonly code: 'UNSUPPORTED_MEDIA_TYPE' | 'PAYLOAD_TOO_LARGE' | 'INVALID_UPLOAD',
    public readonly status: number,
  ) {
    super(code);
    this.name = 'WorkResumeUploadRequestError';
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  UNSUPPORTED_MEDIA_TYPE: 'Content-Type must be multipart/form-data.',
  PAYLOAD_TOO_LARGE: 'The uploaded directory exceeds the supported size.',
  INVALID_UPLOAD: 'The uploaded directory is invalid.',
  UNSAFE_PATH: 'The uploaded directory contains an unsafe path.',
  TOO_MANY_FILES: 'The uploaded directory contains too many files.',
  SECRET_DETECTED: 'A required source document was blocked by the secret policy.',
  UNSUPPORTED_LAYOUT: 'The upload does not contain a supported WorkResume v2 layout.',
  PARSER_VALIDATION_FAILED: 'WorkResume v2 source validation failed.',
  IMPORT_CONFLICT: 'The source revision could not be imported safely.',
  TOO_MANY_ATTEMPTS: 'Too many upload attempts. Try again later.',
};

export function noStoreSourceJson(body: unknown, requestId: string, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

export function workResumeUploadErrorResponse(error: unknown, requestId: string) {
  if (!(error instanceof WorkResumeUploadServiceError)
    && !(error instanceof WorkResumeUploadRequestError)) {
    return authErrorResponse(error, requestId);
  }
  const response = NextResponse.json({
    code: error.code,
    message: ERROR_MESSAGES[error.code] || 'WorkResume upload failed.',
    requestId,
  }, { status: error.status });
  if (error instanceof WorkResumeUploadServiceError && error.retryAfterSeconds) {
    response.headers.set('retry-after', String(error.retryAfterSeconds));
  }
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}
