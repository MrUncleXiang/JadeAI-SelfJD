import type { PersonalInfoContent } from '@/types/resume';

/** Account-level defaults for resume personal_info sections. */
export type ResumePersonalProfile = {
  fullName: string;
  jobTitle: string;
  email: string;
  phone: string;
  wechat: string;
  location: string;
  website: string;
  linkedin: string;
  github: string;
  age: string;
  gender: string;
  politicalStatus: string;
  ethnicity: string;
  hometown: string;
  maritalStatus: string;
  yearsOfExperience: string;
  educationLevel: string;
};

export const EMPTY_RESUME_PERSONAL_PROFILE: ResumePersonalProfile = {
  fullName: '',
  jobTitle: '',
  email: '',
  phone: '',
  wechat: '',
  location: '',
  website: '',
  linkedin: '',
  github: '',
  age: '',
  gender: '',
  politicalStatus: '',
  ethnicity: '',
  hometown: '',
  maritalStatus: '',
  yearsOfExperience: '',
  educationLevel: '',
};

const FIELD_LIMITS: Record<keyof ResumePersonalProfile, number> = {
  fullName: 100,
  jobTitle: 120,
  email: 254,
  phone: 40,
  wechat: 60,
  location: 120,
  website: 300,
  linkedin: 300,
  github: 300,
  age: 20,
  gender: 20,
  politicalStatus: 40,
  ethnicity: 40,
  hometown: 80,
  maritalStatus: 20,
  yearsOfExperience: 40,
  educationLevel: 40,
};

function cleanField(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function isResumePersonalProfile(value: unknown): value is ResumePersonalProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (Object.keys(FIELD_LIMITS) as Array<keyof ResumePersonalProfile>).every((key) => {
    const field = record[key];
    return field === undefined || typeof field === 'string';
  });
}

/** Normalize arbitrary input into a complete, safe profile object. */
export function normalizeResumePersonalProfile(input: unknown): ResumePersonalProfile {
  const source = input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
  const next = { ...EMPTY_RESUME_PERSONAL_PROFILE };
  for (const key of Object.keys(FIELD_LIMITS) as Array<keyof ResumePersonalProfile>) {
    next[key] = cleanField(source[key], FIELD_LIMITS[key]);
  }
  return next;
}

export function resumePersonalProfileFromSettings(
  settings: Record<string, unknown> | null | undefined,
): ResumePersonalProfile {
  return normalizeResumePersonalProfile(settings?.resumePersonalInfo);
}

export function hasResumePersonalProfileContent(profile: ResumePersonalProfile): boolean {
  return Object.values(profile).some((value) => value.trim().length > 0);
}

/**
 * Build personal_info section content from the account profile.
 * Falls back to account display name / email when profile fields are empty.
 */
export function personalInfoContentFromProfile(
  profile: ResumePersonalProfile,
  fallback?: { displayName?: string | null; email?: string | null },
  overrides: Partial<ResumePersonalProfile> = {},
): PersonalInfoContent {
  const fullName = cleanField(overrides.fullName, FIELD_LIMITS.fullName)
    || profile.fullName
    || cleanField(fallback?.displayName, FIELD_LIMITS.fullName);
  const jobTitle = cleanField(overrides.jobTitle, FIELD_LIMITS.jobTitle) || profile.jobTitle;
  const email = cleanField(overrides.email, FIELD_LIMITS.email)
    || profile.email
    || cleanField(fallback?.email, FIELD_LIMITS.email);
  return {
    fullName,
    jobTitle,
    email,
    phone: cleanField(overrides.phone, FIELD_LIMITS.phone) || profile.phone,
    location: cleanField(overrides.location, FIELD_LIMITS.location) || profile.location,
    ...(cleanField(overrides.wechat, FIELD_LIMITS.wechat) || profile.wechat ? { wechat: cleanField(overrides.wechat, FIELD_LIMITS.wechat) || profile.wechat } : {}),
    ...(cleanField(overrides.website, FIELD_LIMITS.website) || profile.website ? { website: cleanField(overrides.website, FIELD_LIMITS.website) || profile.website } : {}),
    ...(cleanField(overrides.linkedin, FIELD_LIMITS.linkedin) || profile.linkedin ? { linkedin: cleanField(overrides.linkedin, FIELD_LIMITS.linkedin) || profile.linkedin } : {}),
    ...(cleanField(overrides.github, FIELD_LIMITS.github) || profile.github ? { github: cleanField(overrides.github, FIELD_LIMITS.github) || profile.github } : {}),
    ...(cleanField(overrides.age, FIELD_LIMITS.age) || profile.age ? { age: cleanField(overrides.age, FIELD_LIMITS.age) || profile.age } : {}),
    ...(cleanField(overrides.gender, FIELD_LIMITS.gender) || profile.gender ? { gender: cleanField(overrides.gender, FIELD_LIMITS.gender) || profile.gender } : {}),
    ...(cleanField(overrides.politicalStatus, FIELD_LIMITS.politicalStatus) || profile.politicalStatus ? { politicalStatus: cleanField(overrides.politicalStatus, FIELD_LIMITS.politicalStatus) || profile.politicalStatus } : {}),
    ...(cleanField(overrides.ethnicity, FIELD_LIMITS.ethnicity) || profile.ethnicity ? { ethnicity: cleanField(overrides.ethnicity, FIELD_LIMITS.ethnicity) || profile.ethnicity } : {}),
    ...(cleanField(overrides.hometown, FIELD_LIMITS.hometown) || profile.hometown ? { hometown: cleanField(overrides.hometown, FIELD_LIMITS.hometown) || profile.hometown } : {}),
    ...(cleanField(overrides.maritalStatus, FIELD_LIMITS.maritalStatus) || profile.maritalStatus ? { maritalStatus: cleanField(overrides.maritalStatus, FIELD_LIMITS.maritalStatus) || profile.maritalStatus } : {}),
    ...(cleanField(overrides.yearsOfExperience, FIELD_LIMITS.yearsOfExperience) || profile.yearsOfExperience ? { yearsOfExperience: cleanField(overrides.yearsOfExperience, FIELD_LIMITS.yearsOfExperience) || profile.yearsOfExperience } : {}),
    ...(cleanField(overrides.educationLevel, FIELD_LIMITS.educationLevel) || profile.educationLevel ? { educationLevel: cleanField(overrides.educationLevel, FIELD_LIMITS.educationLevel) || profile.educationLevel } : {}),
  };
}

/**
 * Prefer non-empty account profile fields over generated / existing content.
 * Keeps generated values only when the account profile leaves that field blank.
 */
export function mergePersonalInfoPreferProfile(
  content: unknown,
  profile: ResumePersonalProfile,
  fallback?: { displayName?: string | null; email?: string | null },
  overrides: Partial<ResumePersonalProfile> = {},
): PersonalInfoContent {
  const base = content && typeof content === 'object' && !Array.isArray(content)
    ? (content as Record<string, unknown>)
    : {};
  const fromProfile = personalInfoContentFromProfile(profile, fallback, overrides);
  const pick = (profileValue: string, existing: unknown): string => {
    if (profileValue) return profileValue;
    return typeof existing === 'string' ? existing : '';
  };

  return {
    fullName: pick(fromProfile.fullName, base.fullName),
    jobTitle: pick(fromProfile.jobTitle || '', base.jobTitle),
    email: pick(fromProfile.email, base.email),
    phone: pick(fromProfile.phone || '', base.phone),
    location: pick(fromProfile.location || '', base.location),
    wechat: pick(fromProfile.wechat || '', base.wechat) || undefined,
    website: pick(fromProfile.website || '', base.website) || undefined,
    linkedin: pick(fromProfile.linkedin || '', base.linkedin) || undefined,
    github: pick(fromProfile.github || '', base.github) || undefined,
    age: pick(fromProfile.age || '', base.age) || undefined,
    gender: pick(fromProfile.gender || '', base.gender) || undefined,
    politicalStatus: pick(fromProfile.politicalStatus || '', base.politicalStatus) || undefined,
    ethnicity: pick(fromProfile.ethnicity || '', base.ethnicity) || undefined,
    hometown: pick(fromProfile.hometown || '', base.hometown) || undefined,
    maritalStatus: pick(fromProfile.maritalStatus || '', base.maritalStatus) || undefined,
    yearsOfExperience: pick(fromProfile.yearsOfExperience || '', base.yearsOfExperience) || undefined,
    educationLevel: pick(fromProfile.educationLevel || '', base.educationLevel) || undefined,
    ...(typeof base.avatar === 'string' && base.avatar ? { avatar: base.avatar } : {}),
    ...(Array.isArray(base.customLinks) ? { customLinks: base.customLinks as PersonalInfoContent['customLinks'] } : {}),
  };
}

/**
 * Prefer imported / parsed content over account profile defaults.
 * Useful for uploaded resumes where extracted values should win when present.
 */
export function mergePersonalInfoPreferImported(
  content: unknown,
  profile: ResumePersonalProfile,
  fallback?: { displayName?: string | null; email?: string | null },
  overrides: Partial<ResumePersonalProfile> = {},
): PersonalInfoContent {
  const base = content && typeof content === 'object' && !Array.isArray(content)
    ? (content as Record<string, unknown>)
    : {};
  const account = personalInfoContentFromProfile(profile, fallback, overrides);
  const pick = (existing: unknown, fallbackValue: string): string => {
    if (typeof existing === 'string' && existing.trim()) return existing;
    return fallbackValue;
  };

  return {
    fullName: pick(base.fullName, account.fullName),
    jobTitle: pick(base.jobTitle, account.jobTitle),
    email: pick(base.email, account.email),
    phone: pick(base.phone, account.phone),
    location: pick(base.location, account.location),
    ...(typeof base.wechat === 'string' && base.wechat ? { wechat: base.wechat } : (account.wechat ? { wechat: account.wechat } : {})),
    ...(typeof base.website === 'string' && base.website ? { website: base.website } : (account.website ? { website: account.website } : {})),
    ...(typeof base.linkedin === 'string' && base.linkedin ? { linkedin: base.linkedin } : (account.linkedin ? { linkedin: account.linkedin } : {})),
    ...(typeof base.github === 'string' && base.github ? { github: base.github } : (account.github ? { github: account.github } : {})),
    ...(typeof base.age === 'string' && base.age ? { age: base.age } : (account.age ? { age: account.age } : {})),
    ...(typeof base.gender === 'string' && base.gender ? { gender: base.gender } : (account.gender ? { gender: account.gender } : {})),
    ...(typeof base.politicalStatus === 'string' && base.politicalStatus ? { politicalStatus: base.politicalStatus } : (account.politicalStatus ? { politicalStatus: account.politicalStatus } : {})),
    ...(typeof base.ethnicity === 'string' && base.ethnicity ? { ethnicity: base.ethnicity } : (account.ethnicity ? { ethnicity: account.ethnicity } : {})),
    ...(typeof base.hometown === 'string' && base.hometown ? { hometown: base.hometown } : (account.hometown ? { hometown: account.hometown } : {})),
    ...(typeof base.maritalStatus === 'string' && base.maritalStatus ? { maritalStatus: base.maritalStatus } : (account.maritalStatus ? { maritalStatus: account.maritalStatus } : {})),
    ...(typeof base.yearsOfExperience === 'string' && base.yearsOfExperience ? { yearsOfExperience: base.yearsOfExperience } : (account.yearsOfExperience ? { yearsOfExperience: account.yearsOfExperience } : {})),
    ...(typeof base.educationLevel === 'string' && base.educationLevel ? { educationLevel: base.educationLevel } : (account.educationLevel ? { educationLevel: account.educationLevel } : {})),
    ...(typeof base.avatar === 'string' && base.avatar ? { avatar: base.avatar } : {}),
    ...(Array.isArray(base.customLinks) ? { customLinks: base.customLinks as PersonalInfoContent['customLinks'] } : {}),
  };
}

export function formatProfileForPrompt(profile: ResumePersonalProfile): string {
  const lines = (Object.keys(FIELD_LIMITS) as Array<keyof ResumePersonalProfile>)
    .map((key) => {
      const value = profile[key];
      return value ? `${key}: ${value}` : null;
    })
    .filter(Boolean);
  return lines.join('\n');
}
