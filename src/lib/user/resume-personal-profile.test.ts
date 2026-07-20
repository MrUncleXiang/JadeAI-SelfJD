import { describe, expect, it } from 'vitest';

import {
  EMPTY_RESUME_PERSONAL_PROFILE,
  formatProfileForPrompt,
  hasResumePersonalProfileContent,
  mergePersonalInfoPreferProfile,
  normalizeResumePersonalProfile,
  personalInfoContentFromProfile,
} from './resume-personal-profile';

describe('resume personal profile', () => {
  it('normalizes and truncates unsafe input', () => {
    const profile = normalizeResumePersonalProfile({
      fullName: '  张三  ',
      jobTitle: 'Unity 工程师',
      email: 'a@example.com',
      phone: 12345,
      website: `https://example.com/${'x'.repeat(400)}`,
      unknown: 'drop-me',
    });

    expect(profile.fullName).toBe('张三');
    expect(profile.jobTitle).toBe('Unity 工程师');
    expect(profile.email).toBe('a@example.com');
    expect(profile.phone).toBe('');
    expect(profile.website.length).toBe(300);
    expect(profile).not.toHaveProperty('unknown');
    expect(hasResumePersonalProfileContent(profile)).toBe(true);
    expect(hasResumePersonalProfileContent(EMPTY_RESUME_PERSONAL_PROFILE)).toBe(false);
  });

  it('builds personal_info content with account fallbacks', () => {
    const content = personalInfoContentFromProfile(
      normalizeResumePersonalProfile({ phone: '13800000000', location: '深圳' }),
      { displayName: 'Admin', email: 'admin@example.com' },
    );
    expect(content).toMatchObject({
      fullName: 'Admin',
      email: 'admin@example.com',
      phone: '13800000000',
      location: '深圳',
      jobTitle: '',
    });
  });

  it('prefers non-empty account profile fields over generated content', () => {
    const merged = mergePersonalInfoPreferProfile(
      {
        fullName: 'AI Name',
        jobTitle: 'AI Title',
        email: 'ai@example.com',
        phone: '100',
        location: 'Beijing',
        website: 'https://ai.example',
      },
      normalizeResumePersonalProfile({
        fullName: '真实姓名',
        email: 'real@example.com',
        phone: '13900000000',
      }),
    );
    expect(merged).toMatchObject({
      fullName: '真实姓名',
      jobTitle: 'AI Title',
      email: 'real@example.com',
      phone: '13900000000',
      location: 'Beijing',
      website: 'https://ai.example',
    });
  });

  it('formats prompt lines without empty fields', () => {
    const text = formatProfileForPrompt(normalizeResumePersonalProfile({
      fullName: 'Jade',
      jobTitle: 'Engineer',
      email: '',
    }));
    expect(text).toContain('fullName: Jade');
    expect(text).toContain('jobTitle: Engineer');
    expect(text).not.toContain('email:');
  });
});
