import { jsonrepair } from 'jsonrepair';

import { resumePatchSchema, type ResumePatch } from './schema';

const MAX_MODEL_OUTPUT_LENGTH = 250_000;

function stripReasoningAndFence(text: string): string {
  const withoutThinking = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\|?thinking\|?>[\s\S]*?<\|?\/?thinking\|?>/gi, '')
    .trim();
  const fenced = withoutThinking.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (fenced?.[1] || withoutThinking).trim();
}

function unwrapJsonString(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 3 && typeof current === 'string'; depth++) {
    current = JSON.parse(current);
  }
  return current;
}

function parseCandidate(text: string): ResumePatch | null {
  try {
    const parsed = unwrapJsonString(JSON.parse(text));
    const result = resumePatchSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function extractResumePatch(text: string): ResumePatch {
  if (!text || text.length > MAX_MODEL_OUTPUT_LENGTH) {
    throw new Error('RESUME_PATCH_OUTPUT_SIZE_INVALID');
  }

  const cleaned = stripReasoningAndFence(text);
  const candidates = [cleaned];
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(cleaned.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    const direct = parseCandidate(candidate);
    if (direct) return direct;
    try {
      const repaired = parseCandidate(jsonrepair(candidate));
      if (repaired) return repaired;
    } catch {
      // Continue to the next deterministic candidate. No model-authored code is executed.
    }
  }

  throw new Error('INVALID_RESUME_PATCH');
}
