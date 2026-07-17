import { createHash } from 'node:crypto';

import type {
  JdRequirementInput,
  JdRequirementPriority,
  JdRequirementType,
} from './types';

export const MAX_JD_TEXT_BYTES = 100_000;
export const MAX_JD_REQUIREMENTS = 120;

export class JdValidationError extends Error {
  constructor(public readonly code: string, message = code) {
    super(message);
    this.name = 'JdValidationError';
  }
}

export function normalizeJdText(value: string): string {
  const normalized = value
    .replace(/\0/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+$/g, ''))
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  if (!normalized) throw new JdValidationError('JD_TEXT_REQUIRED', 'Job description text is required.');
  if (Buffer.byteLength(normalized, 'utf8') > MAX_JD_TEXT_BYTES) {
    throw new JdValidationError('JD_TEXT_TOO_LARGE', 'Job description text exceeds 100,000 bytes.');
  }
  return normalized;
}

export function jdContentHash(normalizedText: string): string {
  return `sha256:${createHash('sha256').update(normalizedText, 'utf8').digest('hex')}`;
}

export function defaultJdTitle(normalizedText: string): string {
  const firstLine = normalizedText.split('\n').find((line) => line.trim())?.trim() || 'Job description';
  return firstLine.slice(0, 120);
}

export function cleanJdField(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizedAlias(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function locateJdExcerpt(normalizedText: string, excerpt: string | undefined) {
  const needle = excerpt?.trim();
  if (!needle) return {};
  const start = normalizedText.indexOf(needle);
  if (start < 0) return {};
  const prefix = normalizedText.slice(0, start);
  return {
    start,
    end: start + needle.length,
    line: prefix.split('\n').length,
  };
}

export function normalizeRequirement(
  input: JdRequirementInput,
  index: number,
): Required<Omit<JdRequirementInput, 'id'>> & { id?: string; sortOrder: number } {
  const text = cleanJdField(input.text, 2_000);
  if (!text) throw new JdValidationError('JD_REQUIREMENT_TEXT_REQUIRED');
  const normalizedTerm = cleanJdField(input.normalizedTerm || text, 240).toLocaleLowerCase();
  const aliases = [...new Set((input.aliases || [])
    .map(normalizedAlias)
    .filter(Boolean))].slice(0, 20);
  const importance = Number.isFinite(input.importance)
    ? Math.max(0, Math.min(1, Number(input.importance)))
    : 0.5;
  return {
    ...(input.id ? { id: input.id } : {}),
    requirementType: input.requirementType as JdRequirementType,
    text,
    normalizedTerm,
    aliases,
    priority: (input.priority || 'normal') as JdRequirementPriority,
    importance,
    sourceLocator: input.sourceLocator && typeof input.sourceLocator === 'object'
      ? input.sourceLocator
      : {},
    sortOrder: index,
  };
}

export function normalizeRequirements(inputs: JdRequirementInput[]) {
  if (inputs.length < 1 || inputs.length > MAX_JD_REQUIREMENTS) {
    throw new JdValidationError('JD_REQUIREMENT_COUNT_INVALID');
  }
  return inputs.map(normalizeRequirement);
}
