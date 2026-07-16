import { createHash } from 'node:crypto';

import { normalizeSectionContent } from '@/lib/resume/normalize-content';

export const RESUME_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export interface ResumeSnapshotSection {
  id: string;
  type: string;
  title: string;
  sortOrder: number;
  visible: boolean;
  content: Record<string, unknown>;
}

export interface ResumeSnapshot {
  schemaVersion: typeof RESUME_SNAPSHOT_SCHEMA_VERSION;
  resume: {
    id: string;
    title: string;
    template: string;
    themeConfig: unknown;
    language: string;
  };
  sections: ResumeSnapshotSection[];
}

type ResumeLike = {
  id: string;
  title: string;
  template: string;
  themeConfig: unknown;
  language: string;
  sections: Array<{
    id: string;
    type: string;
    title: string;
    sortOrder: number;
    visible: boolean;
    content: unknown;
  }>;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) result[key] = canonicalize(child);
    }
    return result;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(canonicalize(value));
  // A missing optional field is a valid hash target for set_field. JSON.stringify
  // returns undefined for a top-level undefined value, so give it a stable token
  // that cannot collide with the JSON encoding of a real string or null.
  return serialized === undefined ? 'undefined' : serialized;
}

export function contentHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function createResumeSnapshot(resume: ResumeLike): ResumeSnapshot {
  const sections = [...resume.sections]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    .map((section, index) => ({
      id: section.id,
      type: section.type,
      title: section.title,
      sortOrder: index,
      visible: Boolean(section.visible),
      content: normalizeSectionContent(section.type, section.content) as Record<string, unknown>,
    }));

  return {
    schemaVersion: RESUME_SNAPSHOT_SCHEMA_VERSION,
    resume: {
      id: resume.id,
      title: resume.title,
      template: resume.template,
      themeConfig: resume.themeConfig || {},
      language: resume.language,
    },
    sections,
  };
}

export function parseResumeSnapshot(value: unknown): ResumeSnapshot {
  let parsed = value;
  if (typeof parsed === 'string') parsed = JSON.parse(parsed);
  if (!parsed || typeof parsed !== 'object') throw new Error('INVALID_RESUME_SNAPSHOT');
  const candidate = parsed as Partial<ResumeSnapshot>;
  if (candidate.schemaVersion !== 1 || !candidate.resume || !Array.isArray(candidate.sections)) {
    throw new Error('INVALID_RESUME_SNAPSHOT');
  }
  return candidate as ResumeSnapshot;
}
