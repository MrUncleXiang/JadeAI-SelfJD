import { generateText, tool } from 'ai';
import { z } from 'zod/v4';

import { getJsonProviderOptions, getModel, type AIConfig } from '@/lib/ai/provider';

import { LlmOutboundRequestError } from './transport';

const VISION_PROBE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAb0lEQVR4nO3PAQkAAAyEwO9feoshgnABdLep8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3IPanc8OLDQitxAAAAAElFTkSuQmCC',
  'base64',
);

export type LlmCapabilityError =
  | 'AUTH_FAILED'
  | 'MODEL_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'OUTBOUND_BLOCKED'
  | 'PROVIDER_ERROR'
  | 'INVALID_RESPONSE'
  | 'UNSUPPORTED';

export type LlmProbeResult = {
  reachable: boolean;
  json: boolean;
  tools: boolean;
  vision: boolean;
  errors: Partial<Record<'reachable' | 'json' | 'tools' | 'vision', LlmCapabilityError>>;
  latencyMs: number;
};

function statusCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  for (const key of ['statusCode', 'status']) {
    const value = (error as Record<string, unknown>)[key];
    if (typeof value === 'number') return value;
  }
  return null;
}

export function classifyLlmProbeError(error: unknown): LlmCapabilityError {
  if (error instanceof LlmOutboundRequestError) {
    return error.code === 'OUTBOUND_TIMEOUT' ? 'TIMEOUT' : 'OUTBOUND_BLOCKED';
  }
  const status = statusCode(error);
  if (status === 401 || status === 403) return 'AUTH_FAILED';
  if (status === 404) return 'MODEL_NOT_FOUND';
  if (status === 408 || status === 504) return 'TIMEOUT';
  if (status === 429) return 'RATE_LIMITED';
  if (error instanceof SyntaxError) return 'INVALID_RESPONSE';
  if (error instanceof Error && /timeout|timed out/i.test(error.name + error.message)) return 'TIMEOUT';
  if (error instanceof Error && /unsupported|not supported|does not support/i.test(error.message)) {
    return 'UNSUPPORTED';
  }
  return 'PROVIDER_ERROR';
}

async function probeReachability(config: AIConfig) {
  const result = await generateText({
    model: getModel(config),
    prompt: 'Connectivity probe. Reply with exactly OK.',
    maxOutputTokens: 16,
    maxRetries: 0,
  });
  if (!result.text.trim()) throw new Error('EMPTY_RESPONSE');
}

async function probeJson(config: AIConfig) {
  const result = await generateText({
    model: getModel(config),
    prompt: 'Return exactly one valid JSON object with this shape: {"ok":true}. Do not use markdown.',
    maxOutputTokens: 32,
    maxRetries: 0,
    providerOptions: getJsonProviderOptions(config),
  });
  const parsed = JSON.parse(result.text.trim()) as { ok?: unknown };
  if (parsed.ok !== true) throw new SyntaxError('INVALID_JSON_PROBE_RESPONSE');
}

async function probeTools(config: AIConfig) {
  const result = await generateText({
    model: getModel(config),
    prompt: 'Call the capabilityProbe tool once with token set to "jade".',
    maxOutputTokens: 64,
    maxRetries: 0,
    tools: {
      capabilityProbe: tool({
        description: 'A no-op tool used only to verify tool calling support.',
        inputSchema: z.object({ token: z.literal('jade') }),
      }),
    },
    toolChoice: { type: 'tool', toolName: 'capabilityProbe' },
  });
  if (!result.toolCalls.some((call) => call.toolName === 'capabilityProbe')) {
    throw new Error('TOOL_NOT_CALLED');
  }
}

async function probeVision(config: AIConfig) {
  const result = await generateText({
    model: getModel(config),
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'This is a capability probe. Briefly identify the dominant color.' },
        { type: 'image', image: VISION_PROBE_PNG, mediaType: 'image/png' },
      ],
    }],
    maxOutputTokens: 32,
    maxRetries: 0,
  });
  if (!result.text.trim()) throw new Error('EMPTY_VISION_RESPONSE');
}

export async function probeLlmCapabilities(config: AIConfig): Promise<LlmProbeResult> {
  const startedAt = Date.now();
  const result: LlmProbeResult = {
    reachable: false,
    json: false,
    tools: false,
    vision: false,
    errors: {},
    latencyMs: 0,
  };

  try {
    await probeReachability(config);
    result.reachable = true;
  } catch (error) {
    result.errors.reachable = classifyLlmProbeError(error);
    result.latencyMs = Date.now() - startedAt;
    return result;
  }

  for (const [capability, probe] of [
    ['json', probeJson],
    ['tools', probeTools],
    ['vision', probeVision],
  ] as const) {
    try {
      await probe(config);
      result[capability] = true;
    } catch (error) {
      result.errors[capability] = classifyLlmProbeError(error);
    }
  }

  result.latencyMs = Date.now() - startedAt;
  return result;
}
