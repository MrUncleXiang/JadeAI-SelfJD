import { NextRequest } from 'next/server';

import { authFailureResponse, resolveActor } from '@/lib/auth/api';
import { getRequestMetadata, hasTrustedOrigin } from '@/lib/auth/http';
import { jdErrorResponse, jdJson, toJdSource } from '@/lib/jd/api';
import { MAX_JD_IMAGE_BYTES } from '@/lib/jd/image-ingestion';
import { jdService, JdServiceError } from '@/lib/jd/service';

export const runtime = 'nodejs';

const MAX_MULTIPART_BYTES = MAX_JD_IMAGE_BYTES + 256 * 1024;

export async function POST(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  if (!hasTrustedOrigin(request)) return authFailureResponse('UNTRUSTED_ORIGIN', metadata.requestId);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (mediaType !== 'multipart/form-data') {
      throw new JdServiceError('UNSUPPORTED_MEDIA_TYPE', 415, 'Content-Type must be multipart/form-data.');
    }
    const contentLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_BYTES) {
      throw new JdServiceError('PAYLOAD_TOO_LARGE', 413, 'JD image upload is too large.');
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      throw new JdServiceError('INVALID_MULTIPART', 400, 'JD image upload is malformed.');
    }
    const upload = formData.get('file');
    if (!(upload instanceof File)) {
      throw new JdServiceError('JD_IMAGE_REQUIRED', 400, 'Select one JD image.');
    }
    const titleValue = formData.get('title');
    const title = typeof titleValue === 'string' ? titleValue.normalize('NFKC').trim() : '';
    if (title.length > 240) {
      throw new JdServiceError('INVALID_INPUT', 400, 'JD display title is too long.');
    }
    if (upload.size > MAX_JD_IMAGE_BYTES) {
      throw new JdServiceError('JD_IMAGE_TOO_LARGE', 413, 'JD image exceeds 10 MiB.');
    }

    const result = await jdService.createImageSource(actor, {
      buffer: Buffer.from(await upload.arrayBuffer()),
      filename: upload.name,
      mimeType: upload.type,
      title: title || undefined,
    });
    return jdJson({
      ...toJdSource(result.source),
      deduplicated: result.deduplicated,
    }, metadata.requestId, result.created ? 201 : 200);
  } catch (error) {
    return jdErrorResponse(error, metadata.requestId);
  }
}
