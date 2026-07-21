import { SECTION_TYPES, TEMPLATES } from '@/lib/constants';
import { normalizeSectionContent } from '@/lib/resume/normalize-content';

import type { ResumePatch, ResumePatchOperation } from './schema';
import { canonicalJson, contentHash, type ResumeSnapshot, type ResumeSnapshotSection } from './snapshot';

const SECTION_TYPE_SET = new Set<string>(SECTION_TYPES);
const TEMPLATE_SET = new Set<string>(TEMPLATES);

const CONTENT_FIELDS: Record<string, ReadonlySet<string>> = {
  personal_info: new Set([
    'fullName', 'jobTitle', 'age', 'gender', 'politicalStatus', 'ethnicity', 'hometown',
    'maritalStatus', 'yearsOfExperience', 'educationLevel', 'email', 'phone', 'wechat',
    'location', 'website', 'linkedin', 'github', 'customLinks', 'avatar',
  ]),
  summary: new Set(['text']),
  work_experience: new Set(['items']),
  education: new Set(['items']),
  skills: new Set(['categories']),
  projects: new Set(['items']),
  certifications: new Set(['items']),
  languages: new Set(['items']),
  github: new Set(['items']),
  qr_codes: new Set(['items']),
  custom: new Set(['items']),
};

const ITEM_FIELDS: Record<string, ReadonlySet<string>> = {
  work_experience: new Set(['id', 'company', 'position', 'location', 'startDate', 'endDate', 'current', 'description', 'technologies', 'highlights']),
  education: new Set(['id', 'institution', 'degree', 'field', 'location', 'startDate', 'endDate', 'gpa', 'highlights']),
  skills: new Set(['id', 'name', 'skills']),
  projects: new Set(['id', 'name', 'url', 'startDate', 'endDate', 'description', 'technologies', 'highlights']),
  certifications: new Set(['id', 'name', 'issuer', 'date', 'url']),
  languages: new Set(['id', 'language', 'proficiency', 'description']),
  github: new Set(['id', 'repoUrl', 'name', 'stars', 'language', 'description']),
  qr_codes: new Set(['id', 'label', 'url']),
  custom: new Set(['id', 'title', 'subtitle', 'date', 'description']),
};

const GITHUB_READ_ONLY_FIELDS = new Set(['repoUrl', 'name', 'stars', 'language']);

export interface ResumePatchReferencePolicy {
  approvedEvidenceIds?: ReadonlySet<string>;
  allowedJdRequirementIds?: ReadonlySet<string>;
  forbiddenClaims?: readonly string[];
}

export interface ResumeOperationDiff {
  path: string;
  before: unknown;
  after: unknown;
  risk: 'normal' | 'high';
  warnings: string[];
}

export interface PreparedResumeOperation {
  operation: ResumePatchOperation;
  diff: ResumeOperationDiff;
}

export class ResumePatchValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly operationId?: string,
  ) {
    super(message);
    this.name = 'ResumePatchValidationError';
  }
}

function cloneSnapshot(snapshot: ResumeSnapshot): ResumeSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as ResumeSnapshot;
}

function objectValue(value: unknown, code: string, operationId: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ResumePatchValidationError(code, 'Operation value must be an object', operationId);
  }
  return value as Record<string, unknown>;
}

function getSection(snapshot: ResumeSnapshot, sectionId: string, operationId: string): ResumeSnapshotSection {
  const section = snapshot.sections.find((candidate) => candidate.id === sectionId);
  if (!section) {
    throw new ResumePatchValidationError('SECTION_NOT_FOUND', 'Target section does not exist', operationId);
  }
  return section;
}

function getList(section: ResumeSnapshotSection, operationId: string): { key: 'items' | 'categories'; values: Record<string, unknown>[] } {
  const key = section.type === 'skills' ? 'categories' : 'items';
  const raw = section.content[key];
  if (!Array.isArray(raw)) {
    throw new ResumePatchValidationError('SECTION_NOT_LIST_BASED', 'Target section is not item based', operationId);
  }
  return { key, values: raw as Record<string, unknown>[] };
}

function getItem(section: ResumeSnapshotSection, itemId: string, operationId: string) {
  const list = getList(section, operationId);
  const index = list.values.findIndex((item) => item?.id === itemId);
  if (index < 0) {
    throw new ResumePatchValidationError('ITEM_NOT_FOUND', 'Target item does not exist', operationId);
  }
  return { ...list, index, item: list.values[index] };
}

function assertAllowedItemFields(section: ResumeSnapshotSection, value: Record<string, unknown>, operationId: string) {
  const allowed = ITEM_FIELDS[section.type];
  if (!allowed) {
    throw new ResumePatchValidationError('SECTION_NOT_LIST_BASED', 'Target section does not accept items', operationId);
  }
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      throw new ResumePatchValidationError('FIELD_NOT_ALLOWED', `Field ${field} is not allowed for ${section.type}`, operationId);
    }
    if (section.type === 'github' && GITHUB_READ_ONLY_FIELDS.has(field)) {
      throw new ResumePatchValidationError('READ_ONLY_FIELD', `GitHub field ${field} is read-only`, operationId);
    }
  }
}

function normalizeText(value: unknown): string {
  return canonicalJson(value).normalize('NFKC').toLocaleLowerCase('en-US');
}

function assertReferences(
  operation: ResumePatchOperation,
  before: unknown,
  after: unknown,
  policy: ResumePatchReferencePolicy,
) {
  const approved = policy.approvedEvidenceIds || new Set<string>();
  for (const evidenceId of operation.evidenceIds) {
    if (!approved.has(evidenceId)) {
      throw new ResumePatchValidationError('EVIDENCE_NOT_APPROVED', 'Operation references unavailable or unapproved evidence', operation.operationId);
    }
  }

  const allowedJd = policy.allowedJdRequirementIds || new Set<string>();
  for (const requirementId of operation.jdRequirementIds) {
    if (!allowedJd.has(requirementId)) {
      throw new ResumePatchValidationError('JD_REQUIREMENT_NOT_ALLOWED', 'Operation references an unavailable JD requirement', operation.operationId);
    }
  }

  const afterText = normalizeText(after);
  for (const claim of policy.forbiddenClaims || []) {
    const normalizedClaim = claim.normalize('NFKC').trim().toLocaleLowerCase('en-US');
    if (normalizedClaim && afterText.includes(normalizedClaim)) {
      throw new ResumePatchValidationError('FORBIDDEN_CLAIM', 'Operation contains a forbidden claim', operation.operationId);
    }
  }

  const beforeText = normalizeText(before);
  const addsNumericClaim = [...afterText.matchAll(/\d+(?:[.,]\d+)?%?/g)]
    .some((match) => !beforeText.includes(match[0]));
  const createsNewItem = operation.type === 'add_item' || operation.type === 'add_section';
  if ((createsNewItem || addsNumericClaim) && operation.evidenceIds.length === 0) {
    throw new ResumePatchValidationError(
      'EVIDENCE_REQUIRED',
      'New items and new quantitative claims require approved evidence',
      operation.operationId,
    );
  }
}

export function expectedHashForOperation(snapshot: ResumeSnapshot, operation: ResumePatchOperation): string {
  switch (operation.type) {
    case 'set_field': {
      const section = getSection(snapshot, operation.sectionId, operation.operationId);
      return contentHash(section.content[operation.value.field]);
    }
    case 'add_item': {
      const section = getSection(snapshot, operation.sectionId, operation.operationId);
      return contentHash(getList(section, operation.operationId).values);
    }
    case 'update_item':
    case 'remove_item': {
      const section = getSection(snapshot, operation.sectionId, operation.operationId);
      return contentHash(getItem(section, operation.itemId, operation.operationId).item);
    }
    case 'add_section':
      return contentHash(snapshot.sections);
    case 'remove_section': {
      const section = getSection(snapshot, operation.sectionId, operation.operationId);
      return contentHash(section);
    }
    case 'move_section':
      return contentHash(snapshot.sections.map(({ id, sortOrder }) => ({ id, sortOrder })));
    case 'set_visibility': {
      const section = getSection(snapshot, operation.sectionId, operation.operationId);
      return contentHash(section.visible);
    }
    case 'set_section_title': {
      const section = getSection(snapshot, operation.sectionId, operation.operationId);
      return contentHash(section.title);
    }
    case 'set_template':
      return contentHash(snapshot.resume.template);
    case 'set_language':
      return contentHash(snapshot.resume.language);
  }
}

function operationTargetKey(operation: ResumePatchOperation): string {
  switch (operation.type) {
    case 'set_field': return `field:${operation.sectionId}:${operation.value.field}`;
    case 'update_item':
    case 'remove_item': return `item:${operation.sectionId}:${operation.itemId}`;
    case 'remove_section': return `section:${operation.sectionId}`;
    case 'set_visibility': return `visibility:${operation.sectionId}`;
    case 'set_section_title': return `section-title:${operation.sectionId}`;
    case 'set_template': return 'template';
    case 'set_language': return 'language';
    default: return `${operation.type}:${operation.operationId}`;
  }
}

function applyUnchecked(snapshot: ResumeSnapshot, operation: ResumePatchOperation): ResumeOperationDiff {
  switch (operation.type) {
    case 'set_field': {
      const section = getSection(snapshot, operation.sectionId, operation.operationId);
      if (section.type !== 'personal_info' && section.type !== 'summary') {
        throw new ResumePatchValidationError(
          'FIELD_NOT_ALLOWED',
          'List-based sections must be changed with item operations',
          operation.operationId,
        );
      }
      const allowed = CONTENT_FIELDS[section.type];
      if (!allowed?.has(operation.value.field)) {
        throw new ResumePatchValidationError('FIELD_NOT_ALLOWED', 'Target field is not public or not supported', operation.operationId);
      }
      const before = section.content[operation.value.field];
      section.content = normalizeSectionContent(section.type, {
        ...section.content,
        [operation.value.field]: operation.value.value,
      });
      return {
        path: `sections/${section.id}/content/${operation.value.field}`,
        before,
        after: section.content[operation.value.field],
        risk: 'normal',
        warnings: [],
      };
    }
    case 'add_item': {
      const section = getSection(snapshot, operation.sectionId, operation.operationId);
      if (section.type === 'github') {
        throw new ResumePatchValidationError(
          'READ_ONLY_SECTION',
          'GitHub repository items must come from an authorized repository sync',
          operation.operationId,
        );
      }
      const value = objectValue(operation.value, 'INVALID_ITEM', operation.operationId);
      assertAllowedItemFields(section, value, operation.operationId);
      if (typeof value.id !== 'string' || !value.id.trim()) {
        throw new ResumePatchValidationError('ITEM_ID_REQUIRED', 'New item must include a stable id', operation.operationId);
      }
      const list = getList(section, operation.operationId);
      if (list.values.some((item) => item.id === value.id)) {
        throw new ResumePatchValidationError('ITEM_ID_CONFLICT', 'New item id already exists', operation.operationId);
      }
      const before = [...list.values];
      section.content = normalizeSectionContent(section.type, {
        ...section.content,
        [list.key]: [...list.values, value],
      });
      return {
        path: `sections/${section.id}/content/${list.key}/${value.id}`,
        before,
        after: section.content[list.key],
        risk: 'normal',
        warnings: [],
      };
    }
    case 'update_item': {
      const section = getSection(snapshot, operation.sectionId, operation.operationId);
      const value = objectValue(operation.value, 'INVALID_ITEM', operation.operationId);
      assertAllowedItemFields(section, value, operation.operationId);
      if (value.id !== undefined && value.id !== operation.itemId) {
        throw new ResumePatchValidationError('ITEM_ID_IMMUTABLE', 'Existing item id cannot be changed', operation.operationId);
      }
      const target = getItem(section, operation.itemId, operation.operationId);
      const before = target.item;
      const values = [...target.values];
      values[target.index] = { ...target.item, ...value, id: operation.itemId };
      section.content = normalizeSectionContent(section.type, { ...section.content, [target.key]: values });
      const normalized = (section.content[target.key] as Record<string, unknown>[])[target.index];
      return {
        path: `sections/${section.id}/content/${target.key}/${operation.itemId}`,
        before,
        after: normalized,
        risk: 'normal',
        warnings: [],
      };
    }
    case 'remove_item': {
      const section = getSection(snapshot, operation.sectionId, operation.operationId);
      const target = getItem(section, operation.itemId, operation.operationId);
      const values = target.values.filter((_, index) => index !== target.index);
      section.content = normalizeSectionContent(section.type, { ...section.content, [target.key]: values });
      return {
        path: `sections/${section.id}/content/${target.key}/${operation.itemId}`,
        before: target.item,
        after: null,
        risk: 'high',
        warnings: ['This operation removes a resume item.'],
      };
    }
    case 'add_section': {
      if (!SECTION_TYPE_SET.has(operation.value.type)) {
        throw new ResumePatchValidationError('SECTION_TYPE_NOT_ALLOWED', 'Section type is not supported', operation.operationId);
      }
      if (snapshot.sections.some((section) => section.id === operation.value.id)) {
        throw new ResumePatchValidationError('SECTION_ID_CONFLICT', 'New section id already exists', operation.operationId);
      }
      const before = cloneSnapshot(snapshot).sections;
      const sortOrder = operation.value.sortOrder ?? snapshot.sections.length;
      snapshot.sections.splice(Math.min(sortOrder, snapshot.sections.length), 0, {
        id: operation.value.id,
        type: operation.value.type,
        title: operation.value.title,
        sortOrder,
        visible: operation.value.visible ?? true,
        content: normalizeSectionContent(operation.value.type, operation.value.content),
      });
      snapshot.sections.forEach((section, index) => { section.sortOrder = index; });
      return {
        path: `sections/${operation.value.id}`,
        before,
        after: snapshot.sections,
        risk: 'normal',
        warnings: [],
      };
    }
    case 'remove_section': {
      const section = getSection(snapshot, operation.sectionId, operation.operationId);
      const before = section;
      snapshot.sections = snapshot.sections.filter((candidate) => candidate.id !== section.id);
      snapshot.sections.forEach((candidate, index) => { candidate.sortOrder = index; });
      return {
        path: `sections/${section.id}`,
        before,
        after: null,
        risk: 'high',
        warnings: ['This operation removes an entire section.'],
      };
    }
    case 'move_section': {
      const section = getSection(snapshot, operation.sectionId, operation.operationId);
      const before = snapshot.sections.map(({ id, sortOrder }) => ({ id, sortOrder }));
      snapshot.sections = snapshot.sections.filter((candidate) => candidate.id !== section.id);
      snapshot.sections.splice(Math.min(operation.value.sortOrder, snapshot.sections.length), 0, section);
      snapshot.sections.forEach((candidate, index) => { candidate.sortOrder = index; });
      return {
        path: 'sections/order',
        before,
        after: snapshot.sections.map(({ id, sortOrder }) => ({ id, sortOrder })),
        risk: 'normal',
        warnings: [],
      };
    }
    case 'set_visibility': {
      const section = getSection(snapshot, operation.sectionId, operation.operationId);
      const before = section.visible;
      section.visible = operation.value;
      return {
        path: `sections/${section.id}/visible`,
        before,
        after: section.visible,
        risk: operation.value ? 'normal' : 'high',
        warnings: operation.value ? [] : ['This operation hides a section from the rendered resume.'],
      };
    }
    case 'set_section_title': {
      const section = getSection(snapshot, operation.sectionId, operation.operationId);
      const before = section.title;
      section.title = operation.value;
      return {
        path: `sections/${section.id}/title`,
        before,
        after: section.title,
        risk: 'normal',
        warnings: [],
      };
    }
    case 'set_template': {
      if (!TEMPLATE_SET.has(operation.value)) {
        throw new ResumePatchValidationError('TEMPLATE_NOT_ALLOWED', 'Template is not supported', operation.operationId);
      }
      const before = snapshot.resume.template;
      snapshot.resume.template = operation.value;
      return {
        path: 'resume/template',
        before,
        after: operation.value,
        risk: 'normal',
        warnings: [],
      };
    }
    case 'set_language': {
      const before = snapshot.resume.language;
      snapshot.resume.language = operation.value;
      return {
        path: 'resume/language',
        before,
        after: snapshot.resume.language,
        risk: 'normal',
        warnings: [],
      };
    }
  }
}

export function prepareResumePatch(
  snapshot: ResumeSnapshot,
  patch: ResumePatch,
  policy: ResumePatchReferencePolicy = {},
): PreparedResumeOperation[] {
  if (patch.resumeId !== snapshot.resume.id) {
    throw new ResumePatchValidationError('RESUME_ID_MISMATCH', 'Patch resumeId does not match the request context');
  }

  const seenTargets = new Set<string>();
  const prepared: PreparedResumeOperation[] = [];
  for (const operation of patch.operations) {
    const actualHash = expectedHashForOperation(snapshot, operation);
    if (actualHash !== operation.expectedHash) {
      throw new ResumePatchValidationError('EXPECTED_HASH_MISMATCH', 'Operation precondition hash does not match the base version', operation.operationId);
    }
    const target = operationTargetKey(operation);
    if (seenTargets.has(target)) {
      throw new ResumePatchValidationError('DUPLICATE_TARGET', 'Multiple operations target the same resume value', operation.operationId);
    }
    seenTargets.add(target);

    const working = cloneSnapshot(snapshot);
    const diff = applyUnchecked(working, operation);
    assertReferences(operation, diff.before, diff.after, policy);
    prepared.push({ operation, diff });
  }

  // Every operation is diffed against the same immutable base version so that
  // its expectedHash remains independently reviewable. Replay the complete
  // sequence once before persisting it to reject combinations that are valid
  // in isolation but cannot be applied together (for example, mutating a
  // section after an earlier operation removed it).
  applyPreparedOperations(snapshot, prepared);

  return prepared;
}

export function applyPreparedOperations(
  snapshot: ResumeSnapshot,
  operations: readonly PreparedResumeOperation[],
): ResumeSnapshot {
  const next = cloneSnapshot(snapshot);
  for (const prepared of operations) applyUnchecked(next, prepared.operation);
  next.sections.forEach((section, index) => { section.sortOrder = index; });
  return next;
}
