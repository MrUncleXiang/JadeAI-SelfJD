export const JD_INPUT_TYPES = ['text', 'pdf', 'docx', 'image'] as const;
export const JD_SOURCE_STATUSES = ['draft', 'parsing', 'needs_review', 'confirmed', 'failed'] as const;
export const JD_REQUIREMENT_TYPES = [
  'responsibility',
  'hard_skill',
  'soft_skill',
  'experience',
  'education',
  'preferred',
] as const;
export const JD_REQUIREMENT_PRIORITIES = ['required', 'preferred', 'normal'] as const;

export type JdInputType = typeof JD_INPUT_TYPES[number];
export type JdSourceStatus = typeof JD_SOURCE_STATUSES[number];
export type JdRequirementType = typeof JD_REQUIREMENT_TYPES[number];
export type JdRequirementPriority = typeof JD_REQUIREMENT_PRIORITIES[number];

export interface JdRequirementInput {
  id?: string;
  requirementType: JdRequirementType;
  text: string;
  normalizedTerm?: string;
  aliases?: string[];
  priority?: JdRequirementPriority;
  importance?: number;
  sourceLocator?: Record<string, unknown>;
}

export interface JdExtractionCandidate {
  title?: string;
  company?: string;
  jobTitle?: string;
  location?: string;
  requirements: Array<JdRequirementInput & { sourceText?: string }>;
}
