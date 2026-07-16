import { NextRequest, NextResponse } from 'next/server';

import { AIConfigError, type AIConfig } from '@/lib/ai/provider';
import { authFailureResponse, resolveActor } from '@/lib/auth/api';
import { getRequestMetadata } from '@/lib/auth/http';
import { resolveOwnedLlmConfig } from '@/lib/llm/resolver';

const MAX_MODELS_RESPONSE_BYTES = 1024 * 1024;

function appendPath(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

async function readJsonWithLimit(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_MODELS_RESPONSE_BYTES) {
    throw new Error('MODEL_LIST_TOO_LARGE');
  }

  if (!response.body) throw new SyntaxError('EMPTY_MODEL_LIST_RESPONSE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_MODELS_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('MODEL_LIST_TOO_LARGE');
    }
    chunks.push(value);
  }

  const payload = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    payload.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(payload));
}

async function fetchModelIds(config: AIConfig): Promise<string[]> {
  let url: string;
  let headers: Record<string, string>;

  switch (config.provider) {
    case 'anthropic': {
      const base = new URL(config.baseURL);
      const path = base.pathname.replace(/\/$/, '').endsWith('/v1') ? 'models' : 'v1/models';
      url = appendPath(config.baseURL, path);
      headers = {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      };
      break;
    }
    case 'gemini':
      url = appendPath(config.baseURL, 'models');
      headers = { 'x-goog-api-key': config.apiKey };
      break;
    default:
      url = appendPath(config.baseURL, 'models');
      headers = { Authorization: `Bearer ${config.apiKey}` };
  }

  const response = await (config.fetch || fetch)(url, { headers });
  if (!response.ok) throw new Error(`MODEL_LIST_HTTP_${response.status}`);
  const payload = await readJsonWithLimit(response) as {
    data?: Array<{ id?: unknown }>;
    models?: Array<{ id?: unknown; name?: unknown }>;
  } | Array<{ id?: unknown }>;
  const rows = Array.isArray(payload)
    ? payload
    : config.provider === 'gemini'
      ? payload.models || []
      : payload.data || payload.models || [];

  return [...new Set(rows.flatMap((row: { id?: unknown; name?: unknown }) => {
    const raw = typeof row.id === 'string' ? row.id : row.name;
    if (typeof raw !== 'string' || raw.length > 200) return [];
    return [raw.replace(/^models\//, '')];
  }))].sort().slice(0, 1_000);
}

export async function GET(request: NextRequest) {
  const metadata = getRequestMetadata(request);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);

    const profileId = request.nextUrl.searchParams.get('profileId');
    if (!profileId) {
      return NextResponse.json({
        code: 'INVALID_INPUT',
        message: 'profileId is required',
        requestId: metadata.requestId,
      }, { status: 400, headers: { 'x-request-id': metadata.requestId } });
    }

    const config = await resolveOwnedLlmConfig(actor.userId, profileId, { allowInvalid: true });
    const models = (await fetchModelIds(config)).map((id) => ({ id }));
    const response = NextResponse.json({ models });
    response.headers.set('cache-control', 'no-store');
    response.headers.set('x-request-id', metadata.requestId);
    return response;
  } catch (error) {
    if (error instanceof AIConfigError) {
      return NextResponse.json({
        code: error.code,
        message: error.message,
        requestId: metadata.requestId,
      }, { status: error.status, headers: { 'x-request-id': metadata.requestId } });
    }
    console.error('GET /api/ai/models error:', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({
      code: 'LLM_MODEL_LIST_FAILED',
      message: 'Failed to list models from the selected LLM profile',
      requestId: metadata.requestId,
    }, { status: 502, headers: { 'x-request-id': metadata.requestId } });
  }
}
