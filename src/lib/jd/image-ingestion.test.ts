import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  JD_MODEL_IMAGE_MIME,
  jdImageContentHash,
  MAX_JD_MODEL_IMAGE_DIMENSION,
  MAX_JD_IMAGE_BYTES,
  validateJdImage,
} from './image-ingestion';

describe('JD image validation [JD-002]', () => {
  it('accepts a fully decodable PNG and returns stable metadata', async () => {
    const buffer = await sharp({
      create: { width: 120, height: 80, channels: 3, background: '#ffffff' },
    }).png().toBuffer();
    const result = await validateJdImage({
      buffer,
      filename: '../screenshots/岗位JD.png',
      mimeType: 'image/png',
    });
    expect(result).toMatchObject({
      mimeType: 'image/png',
      originalFilename: '岗位JD.png',
      width: 120,
      height: 80,
      sizeBytes: buffer.length,
      contentHash: jdImageContentHash(buffer),
      modelMimeType: JD_MODEL_IMAGE_MIME,
      modelWidth: 120,
      modelHeight: 80,
    });
    expect((await sharp(result.modelBuffer).metadata()).format).toBe('jpeg');
  });

  it('normalizes large provider input to a bounded, metadata-free JPEG', async () => {
    const buffer = await sharp({
      create: { width: 5_000, height: 1_000, channels: 4, background: '#ffffff80' },
    }).png().withMetadata({ orientation: 1 }).toBuffer();
    const result = await validateJdImage({
      buffer,
      filename: 'wide-jd.png',
      mimeType: 'image/png',
    });
    const metadata = await sharp(result.modelBuffer).metadata();
    expect(metadata).toMatchObject({
      format: 'jpeg',
      width: MAX_JD_MODEL_IMAGE_DIMENSION,
      height: 819,
    });
    expect(metadata.orientation).toBeUndefined();
  });

  it('rejects MIME/magic and filename-extension mismatches', async () => {
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#000000' },
    }).png().toBuffer();
    await expect(validateJdImage({
      buffer: png,
      filename: 'jd.jpg',
      mimeType: 'image/jpeg',
    })).rejects.toMatchObject({ code: 'JD_IMAGE_MAGIC_MISMATCH', status: 415 });
    await expect(validateJdImage({
      buffer: png,
      filename: 'jd.jpg',
      mimeType: 'image/png',
    })).rejects.toMatchObject({ code: 'JD_IMAGE_EXTENSION_MISMATCH', status: 415 });
  });

  it('rejects oversized, over-dimensioned, and corrupt payloads before LLM use', async () => {
    await expect(validateJdImage({
      buffer: Buffer.alloc(MAX_JD_IMAGE_BYTES + 1),
      filename: 'large.png',
      mimeType: 'image/png',
    })).rejects.toMatchObject({ code: 'JD_IMAGE_TOO_LARGE', status: 413 });

    const tooWide = await sharp({
      create: { width: 8_001, height: 1, channels: 3, background: '#ffffff' },
    }).png().toBuffer();
    await expect(validateJdImage({
      buffer: tooWide,
      filename: 'wide.png',
      mimeType: 'image/png',
    })).rejects.toMatchObject({ code: 'JD_IMAGE_DIMENSIONS_TOO_LARGE', status: 413 });

    await expect(validateJdImage({
      buffer: Buffer.from('not an image'),
      filename: 'bad.webp',
      mimeType: 'image/webp',
    })).rejects.toMatchObject({ code: 'JD_IMAGE_INVALID', status: 400 });
  });
});
