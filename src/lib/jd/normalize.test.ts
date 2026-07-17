import { describe, expect, it } from 'vitest';

import {
  defaultJdTitle,
  jdContentHash,
  locateJdExcerpt,
  normalizeJdText,
  normalizeRequirements,
} from './normalize';

describe('JD normalization', () => {
  it('normalizes line endings, trims trailing whitespace, and produces a stable hash', () => {
    const normalized = normalizeJdText(' Senior Unity Engineer  \r\n\r\nC#\t \r\n');
    expect(normalized).toBe('Senior Unity Engineer\n\nC#');
    expect(jdContentHash(normalized)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(jdContentHash(normalized)).toBe(jdContentHash(normalizeJdText(normalized)));
    expect(defaultJdTitle(normalized)).toBe('Senior Unity Engineer');
  });

  it('locates exact evidence and normalizes reviewable requirements', () => {
    const text = 'Responsibilities\nBuild Unity tools\nRequirements\n3+ years C#';
    expect(locateJdExcerpt(text, '3+ years C#')).toEqual({ start: 48, end: 59, line: 4 });
    expect(normalizeRequirements([{
      requirementType: 'hard_skill',
      text: ' C# ',
      aliases: ['C Sharp', 'C Sharp', ''],
      priority: 'required',
      importance: 1.2,
      sourceLocator: { line: 4 },
    }])).toEqual([expect.objectContaining({
      requirementType: 'hard_skill',
      text: 'C#',
      normalizedTerm: 'c#',
      aliases: ['C Sharp'],
      priority: 'required',
      importance: 1,
      sourceLocator: { line: 4 },
      sortOrder: 0,
    })]);
  });

  it('rejects empty text and empty requirements', () => {
    expect(() => normalizeJdText(' \n ')).toThrowError(expect.objectContaining({ code: 'JD_TEXT_REQUIRED' }));
    expect(() => normalizeRequirements([])).toThrowError(expect.objectContaining({
      code: 'JD_REQUIREMENT_COUNT_INVALID',
    }));
  });
});
