import { normalizeSectionContent } from '@/lib/resume/normalize-content';

import { resumePatchSchema, type ResumePatch, type ResumePatchOperation } from './schema';
import { canonicalJson, contentHash, type ResumeSnapshot, type ResumeSnapshotSection } from './snapshot';

export interface TranslatedResumeSection {
  sectionId: string;
  title: string;
  content: unknown;
}

interface BuildTranslationPatchInput {
  snapshot: ResumeSnapshot;
  baseVersionId: string;
  targetLanguage: string;
  translations: readonly TranslatedResumeSection[];
  setResumeLanguage?: boolean;
}

const DIRECT_FIELD_SECTIONS = new Set(['personal_info', 'summary']);
const PATCH_OPERATION_LIMIT = 80;
const READ_ONLY_ITEM_FIELDS: Record<string, ReadonlySet<string>> = {
  github: new Set(['repoUrl', 'name', 'stars', 'language']),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sameValue(left: unknown, right: unknown) {
  return canonicalJson(left) === canonicalJson(right);
}

function jsonClone(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function listKeyFor(section: ResumeSnapshotSection): 'items' | 'categories' | null {
  if (section.type === 'skills') return 'categories';
  if (Array.isArray(section.content.items)) return 'items';
  if (Array.isArray(section.content.categories)) return 'categories';
  return null;
}

function operationId(index: number, suffix: string) {
  const safeSuffix = suffix.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 150);
  return `translate-${String(index + 1).padStart(3, '0')}-${safeSuffix}`;
}

function common(operationIndex: number, reason: string) {
  return {
    operationId: operationId(operationIndex, reason),
    reason,
    evidenceIds: [],
    jdRequirementIds: [],
    confidence: 0.9,
  };
}

function changedExistingFields(
  section: ResumeSnapshotSection,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  warnings: Set<string>,
) {
  const changes: Record<string, unknown> = {};
  for (const [field, beforeValue] of Object.entries(before)) {
    if (field === 'id') continue;
    if (READ_ONLY_ITEM_FIELDS[section.type]?.has(field)) continue;
    if (!(field in after)) {
      warnings.add(`Section "${section.title}" translation omitted field "${field}"; kept original value.`);
      continue;
    }
    const cloned = jsonClone(after[field]);
    if (cloned === undefined) continue;
    if (!sameValue(beforeValue, cloned)) changes[field] = cloned;
  }
  return changes;
}

/**
 * Converts section-by-section translation output into a reviewable ResumePatch.
 *
 * The live resume is not mutated here. The patch deliberately updates only
 * existing scalar fields/list items and never adds/removes sections or items, so
 * translation remains a wording change that must pass the same Change Set review
 * boundary as other AI-generated edits.
 */
export function buildTranslationResumePatch(input: BuildTranslationPatchInput): ResumePatch {
  const warnings = new Set<string>();
  const operations: ResumePatchOperation[] = [];
  const translationBySectionId = new Map(input.translations.map((section) => [section.sectionId, section]));

  function push(operation: ResumePatchOperation) {
    operations.push(operation);
  }

  for (const section of input.snapshot.sections) {
    const translated = translationBySectionId.get(section.id);
    if (!translated) continue;

    const normalizedTranslatedContent = isRecord(translated.content)
      ? normalizeSectionContent(section.type, translated.content) as Record<string, unknown>
      : null;
    if (!normalizedTranslatedContent) {
      warnings.add(`Section "${section.title}" translation returned invalid content; skipped content changes.`);
    }

    if (translated.title && translated.title !== section.title) {
      const index = operations.length;
      push({
        ...common(index, `Translate section title "${section.title}" to ${input.targetLanguage}`),
        type: 'set_section_title',
        sectionId: section.id,
        expectedHash: contentHash(section.title),
        value: translated.title,
      });
    }

    if (!normalizedTranslatedContent) continue;

    if (DIRECT_FIELD_SECTIONS.has(section.type)) {
      for (const [field, beforeValue] of Object.entries(section.content)) {
        if (!(field in normalizedTranslatedContent)) continue;
        const value = jsonClone(normalizedTranslatedContent[field]);
        if (value === undefined || sameValue(beforeValue, value)) continue;
        const index = operations.length;
        push({
          ...common(index, `Translate ${section.title}.${field} to ${input.targetLanguage}`),
          type: 'set_field',
          sectionId: section.id,
          expectedHash: contentHash(beforeValue),
          value: { field, value },
        });
      }
      continue;
    }

    const listKey = listKeyFor(section);
    if (!listKey) {
      warnings.add(`Section "${section.title}" is not a supported translatable shape; skipped content changes.`);
      continue;
    }

    const beforeList = section.content[listKey];
    const afterList = normalizedTranslatedContent[listKey];
    if (!Array.isArray(beforeList) || !Array.isArray(afterList)) {
      warnings.add(`Section "${section.title}" translation did not preserve the ${listKey} list; skipped content changes.`);
      continue;
    }
    if (beforeList.length !== afterList.length) {
      warnings.add(`Section "${section.title}" translation changed item count; only matching existing items were considered.`);
    }

    const afterById = new Map<string, Record<string, unknown>>();
    for (const afterItem of afterList) {
      if (isRecord(afterItem) && typeof afterItem.id === 'string') {
        afterById.set(afterItem.id, afterItem);
      }
    }

    for (let itemIndex = 0; itemIndex < beforeList.length; itemIndex++) {
      const beforeItem = beforeList[itemIndex];
      if (!isRecord(beforeItem) || typeof beforeItem.id !== 'string') continue;
      const afterItem = afterById.get(beforeItem.id)
        || (isRecord(afterList[itemIndex]) ? afterList[itemIndex] as Record<string, unknown> : null);
      if (!afterItem) {
        warnings.add(`Section "${section.title}" item "${beforeItem.id}" was missing after translation; kept original item.`);
        continue;
      }
      if (afterItem.id !== undefined && afterItem.id !== beforeItem.id) {
        warnings.add(`Section "${section.title}" item id changed at row ${itemIndex + 1}; kept original id.`);
      }

      const changes = changedExistingFields(section, beforeItem, afterItem, warnings);
      if (Object.keys(changes).length === 0) continue;
      const index = operations.length;
      push({
        ...common(index, `Translate ${section.title} item "${beforeItem.id}" to ${input.targetLanguage}`),
        type: 'update_item',
        sectionId: section.id,
        itemId: beforeItem.id,
        expectedHash: contentHash(beforeItem),
        value: changes,
      });
    }
  }

  if (input.setResumeLanguage && input.snapshot.resume.language !== input.targetLanguage) {
    const index = operations.length;
    push({
      ...common(index, `Set resume language to ${input.targetLanguage}`),
      type: 'set_language',
      expectedHash: contentHash(input.snapshot.resume.language),
      value: input.targetLanguage,
    });
  }

  if (operations.length === 0) {
    throw new Error('NO_TRANSLATION_CHANGES');
  }
  if (operations.length > PATCH_OPERATION_LIMIT) {
    throw new Error('TOO_MANY_TRANSLATION_CHANGES');
  }

  return resumePatchSchema.parse({
    schemaVersion: 1,
    resumeId: input.snapshot.resume.id,
    baseVersionId: input.baseVersionId,
    summary: `Translate resume to ${input.targetLanguage}`,
    operations,
    warnings: [...warnings].slice(0, 20),
  });
}
