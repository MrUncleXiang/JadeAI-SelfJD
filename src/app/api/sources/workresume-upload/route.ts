import { NextRequest } from 'next/server';

import { authFailureResponse, resolveActor } from '@/lib/auth/api';
import { getRequestMetadata, hasTrustedOrigin } from '@/lib/auth/http';
import {
  noStoreSourceJson,
  WorkResumeUploadRequestError,
  workResumeUploadErrorResponse,
} from '@/lib/source/api';
import {
  WORKRESUME_UPLOAD_MAX_FILES,
  WORKRESUME_UPLOAD_MAX_REQUEST_BYTES,
  WORKRESUME_UPLOAD_SCHEMA_VERSION,
  type WorkResumeUploadEntry,
} from '@/lib/source/workresume-upload';
import { workResumeUploadService } from '@/lib/source/workresume-upload-service';

export const runtime = 'nodejs';

function contentLength(request: NextRequest): number | null {
  const raw = request.headers.get('content-length');
  if (!raw || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function readBoundedBody(request: NextRequest): Promise<Buffer> {
  if (!request.body) throw new WorkResumeUploadRequestError('INVALID_UPLOAD', 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > WORKRESUME_UPLOAD_MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new WorkResumeUploadRequestError('PAYLOAD_TOO_LARGE', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}

async function readUpload(request: NextRequest) {
  const contentType = request.headers.get('content-type');
  const mediaType = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'multipart/form-data') {
    throw new WorkResumeUploadRequestError('UNSUPPORTED_MEDIA_TYPE', 415);
  }
  const declaredLength = contentLength(request);
  if (declaredLength !== null && declaredLength > WORKRESUME_UPLOAD_MAX_REQUEST_BYTES) {
    throw new WorkResumeUploadRequestError('PAYLOAD_TOO_LARGE', 413);
  }

  let form: FormData;
  try {
    const body = await readBoundedBody(request);
    form = await new Request(request.url, {
      method: 'POST',
      headers: { 'content-type': contentType! },
      body: new Uint8Array(body).buffer,
    }).formData();
  } catch (error) {
    if (error instanceof WorkResumeUploadRequestError) throw error;
    throw new WorkResumeUploadRequestError('INVALID_UPLOAD', 400);
  }
  if (form.get('schemaVersion') !== WORKRESUME_UPLOAD_SCHEMA_VERSION) {
    throw new WorkResumeUploadRequestError('INVALID_UPLOAD', 400);
  }
  const rawSourceName = form.get('sourceName');
  if (rawSourceName !== null && typeof rawSourceName !== 'string') {
    throw new WorkResumeUploadRequestError('INVALID_UPLOAD', 400);
  }
  const rawPaths = form.getAll('paths');
  const rawFiles = form.getAll('files');
  if (rawPaths.length === 0
    || rawPaths.length !== rawFiles.length
    || rawFiles.length > WORKRESUME_UPLOAD_MAX_FILES
    || rawPaths.some((value) => typeof value !== 'string' || value.length > 1024)
    || rawFiles.some((value) => typeof value === 'string')) {
    throw new WorkResumeUploadRequestError(
      rawFiles.length > WORKRESUME_UPLOAD_MAX_FILES ? 'PAYLOAD_TOO_LARGE' : 'INVALID_UPLOAD',
      rawFiles.length > WORKRESUME_UPLOAD_MAX_FILES ? 413 : 400,
    );
  }

  const entries: WorkResumeUploadEntry[] = [];
  let actualBytes = 0;
  for (let index = 0; index < rawFiles.length; index++) {
    const file = rawFiles[index] as File;
    actualBytes += file.size;
    if (actualBytes > WORKRESUME_UPLOAD_MAX_REQUEST_BYTES) {
      throw new WorkResumeUploadRequestError('PAYLOAD_TOO_LARGE', 413);
    }
    entries.push({
      path: rawPaths[index] as string,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
  }
  return { sourceName: rawSourceName || undefined, entries };
}

export async function GET(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    return noStoreSourceJson(await workResumeUploadService.getStatus(actor), metadata.requestId);
  } catch (error) {
    return workResumeUploadErrorResponse(error, metadata.requestId);
  }
}

export async function POST(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  if (!hasTrustedOrigin(request)) {
    return authFailureResponse('UNTRUSTED_ORIGIN', metadata.requestId);
  }
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const input = await readUpload(request);
    const result = await workResumeUploadService.importDirectory(actor, input);
    return noStoreSourceJson(result, metadata.requestId, result.alreadyImported ? 200 : 201);
  } catch (error) {
    return workResumeUploadErrorResponse(error, metadata.requestId);
  }
}
