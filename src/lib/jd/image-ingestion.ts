import { createHash } from 'node:crypto';

import sharp from 'sharp';

export const MAX_JD_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_JD_IMAGE_DIMENSION = 8_000;
export const MAX_JD_IMAGE_PIXELS = 40_000_000;

const FORMAT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
} as const;

const EXTENSIONS_BY_MIME: Record<keyof typeof FORMAT_BY_MIME, ReadonlySet<string>> = {
  'image/png': new Set(['.png']),
  'image/jpeg': new Set(['.jpg', '.jpeg']),
  'image/webp': new Set(['.webp']),
};

export type SupportedJdImageMime = keyof typeof FORMAT_BY_MIME;

export class JdImageValidationError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message = code,
  ) {
    super(message);
    this.name = 'JdImageValidationError';
  }
}

function normalizedMime(value: string): string {
  return value.split(';', 1)[0]?.trim().toLowerCase() || '';
}

function filenameExtension(filename: string) {
  const match = /(?:^|\/)([^/]*)$/.exec(filename.replace(/\\/g, '/'));
  const basename = match?.[1] || '';
  const dot = basename.lastIndexOf('.');
  return dot > 0 ? basename.slice(dot).toLowerCase() : '';
}

export function cleanJdImageFilename(value: string, mimeType: SupportedJdImageMime) {
  const basename = value
    .normalize('NFKC')
    .replace(/\0/g, '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  const fallbackExtension = mimeType === 'image/jpeg' ? '.jpg' : `.${FORMAT_BY_MIME[mimeType]}`;
  return (basename || `job-description${fallbackExtension}`).slice(0, 240);
}

export function jdImageContentHash(buffer: Buffer) {
  return `sha256:${createHash('sha256')
    .update('jadeai:jd:image:v1\0', 'utf8')
    .update(buffer)
    .digest('hex')}`;
}

export async function validateJdImage(input: {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}) {
  if (input.buffer.length < 1) {
    throw new JdImageValidationError('JD_IMAGE_REQUIRED', 400, 'Select a job-description image.');
  }
  if (input.buffer.length > MAX_JD_IMAGE_BYTES) {
    throw new JdImageValidationError('JD_IMAGE_TOO_LARGE', 413, 'JD image exceeds 10 MiB.');
  }

  const mimeType = normalizedMime(input.mimeType);
  if (!(mimeType in FORMAT_BY_MIME)) {
    throw new JdImageValidationError(
      'JD_IMAGE_TYPE_UNSUPPORTED',
      415,
      'JD image must be PNG, JPEG, or WebP.',
    );
  }
  const supportedMime = mimeType as SupportedJdImageMime;
  const originalFilename = cleanJdImageFilename(input.filename, supportedMime);
  const extension = filenameExtension(originalFilename);
  if (!EXTENSIONS_BY_MIME[supportedMime].has(extension)) {
    throw new JdImageValidationError(
      'JD_IMAGE_EXTENSION_MISMATCH',
      415,
      'Image filename extension does not match its declared MIME type.',
    );
  }

  try {
    const decoder = sharp(input.buffer, {
      failOn: 'error',
      limitInputPixels: MAX_JD_IMAGE_PIXELS,
      sequentialRead: true,
    });
    const metadata = await decoder.metadata();
    if (metadata.format !== FORMAT_BY_MIME[supportedMime]) {
      throw new JdImageValidationError(
        'JD_IMAGE_MAGIC_MISMATCH',
        415,
        'Image bytes do not match the declared MIME type.',
      );
    }
    if (!metadata.width || !metadata.height) {
      throw new JdImageValidationError('JD_IMAGE_INVALID', 400, 'Image dimensions are unavailable.');
    }
    if (metadata.width > MAX_JD_IMAGE_DIMENSION || metadata.height > MAX_JD_IMAGE_DIMENSION) {
      throw new JdImageValidationError(
        'JD_IMAGE_DIMENSIONS_TOO_LARGE',
        413,
        `JD image dimensions must not exceed ${MAX_JD_IMAGE_DIMENSION}px.`,
      );
    }
    if (metadata.width * metadata.height > MAX_JD_IMAGE_PIXELS) {
      throw new JdImageValidationError(
        'JD_IMAGE_PIXELS_TOO_LARGE',
        413,
        'JD image contains too many pixels.',
      );
    }
    if ((metadata.pages || 1) > 1) {
      throw new JdImageValidationError(
        'JD_IMAGE_ANIMATION_UNSUPPORTED',
        415,
        'Animated or multi-page images are not supported.',
      );
    }

    // Force a complete decode after metadata checks so truncated/corrupt payloads are rejected
    // before any bytes leave the deployment.
    await sharp(input.buffer, {
      failOn: 'error',
      limitInputPixels: MAX_JD_IMAGE_PIXELS,
      sequentialRead: true,
    }).stats();

    return {
      mimeType: supportedMime,
      originalFilename,
      width: metadata.width,
      height: metadata.height,
      sizeBytes: input.buffer.length,
      contentHash: jdImageContentHash(input.buffer),
    };
  } catch (error) {
    if (error instanceof JdImageValidationError) throw error;
    throw new JdImageValidationError('JD_IMAGE_INVALID', 400, 'Image data is invalid or corrupt.');
  }
}
