import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
  process.env.REGISTRATION_MODE = 'open';
  process.env.SEED_DEMO_DATA = 'false';
});

import { dbReady } from '@/lib/db';
import { authRepository } from '@/lib/db/repositories/auth.repository';
import { authService } from '@/lib/auth/service';
import { POST as createResume } from '@/app/api/resume/route';
import { POST as applyResumeProfile } from '@/app/api/resume/[id]/personal-info/apply-profile/route';
import { resumeRepository } from '@/lib/db/repositories/resume.repository';
import { GET as getSettings, PUT as putSettings } from './settings/route';

const suffix = crypto.randomUUID().slice(0, 8);
let cookie = '';
let userId = '';

function jsonRequest(path: string, body: unknown, method = 'POST') {
  return new NextRequest(`https://resume.test${path}`, {
    method,
    headers: {
      cookie,
      origin: 'https://resume.test',
      'content-type': 'application/json',
      'x-request-id': `resume-profile-${suffix}`,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await dbReady;
  await authRepository.setRegistrationMode('open');
  const registered = await authService.register({
    username: `resume_profile_${suffix}`,
    displayName: '账号显示名',
    email: `resume-profile-${suffix}@example.com`,
    password: 'resume profile route password long enough',
  }, { requestId: `resume-profile-register-${suffix}` });
  cookie = `jade_session=${registered.token}`;
  userId = registered.user.id;
});

describe('account resume personal info [AUTH-008]', () => {
  it('loads account fallbacks before an explicit resume profile is saved', async () => {
    const response = await getSettings(new NextRequest('https://resume.test/api/user/settings', {
      headers: { cookie },
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      resumePersonalInfo: {
        fullName: '账号显示名',
        email: expect.stringMatching(/^resume-profile-/),
        phone: '',
      },
    });
  });

  it('persists resume personal info and seeds new template resumes', async () => {
    const saved = await putSettings(jsonRequest('/api/user/settings', {
      resumePersonalInfo: {
        fullName: '简历姓名',
        jobTitle: 'Unity 客户端工程师',
        email: 'resume-owner@example.com',
        phone: '13800138000',
        wechat: 'resume-wechat',
        location: '深圳',
        website: 'https://example.com',
        linkedin: '',
        github: 'https://github.com/example',
        age: '28',
        gender: '',
        politicalStatus: '',
        ethnicity: '',
        hometown: '',
        maritalStatus: '',
        yearsOfExperience: '6',
        educationLevel: '本科',
      },
    }, 'PUT'));
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      resumePersonalInfo: {
        fullName: '简历姓名',
        jobTitle: 'Unity 客户端工程师',
        email: 'resume-owner@example.com',
        phone: '13800138000',
        location: '深圳',
        github: 'https://github.com/example',
      },
    });

    const created = await createResume(jsonRequest('/api/resume', {
      template: 'modern',
      language: 'zh',
    }));
    expect(created.status).toBe(201);
    const resume = await created.json();
    const personal = resume.sections.find((section: { type: string }) => section.type === 'personal_info');
    expect(personal?.content).toMatchObject({
      fullName: '简历姓名',
      jobTitle: 'Unity 客户端工程师',
      email: 'resume-owner@example.com',
      phone: '13800138000',
      wechat: 'resume-wechat',
      location: '深圳',
      github: 'https://github.com/example',
      yearsOfExperience: '6',
      educationLevel: '本科',
    });
  });

  it('fills only missing personal fields during JSON import', async () => {
    const imported = await createResume(jsonRequest('/api/resume', {
      title: '导入简历',
      sections: [{
        type: 'personal_info',
        title: '个人信息',
        visible: true,
        content: {
          fullName: '导入姓名',
          jobTitle: '',
          email: 'imported@example.com',
          phone: '',
          location: '北京',
        },
      }],
    }));
    expect(imported.status).toBe(201);
    const resume = await imported.json();
    const personal = resume.sections.find((section: { type: string }) => section.type === 'personal_info');
    expect(personal?.content).toMatchObject({
      fullName: '导入姓名',
      jobTitle: 'Unity 客户端工程师',
      email: 'imported@example.com',
      phone: '13800138000',
      location: '北京',
    });
  });

  it('applies saved account personal info to an existing old resume', async () => {
    const saved = await putSettings(jsonRequest('/api/user/settings', {
      resumePersonalInfo: {
        fullName: '旧简历同步姓名',
        jobTitle: 'Unity 客户端负责人',
        email: 'old-resume-owner@example.com',
        phone: '13900139000',
        location: '广州',
        yearsOfExperience: '7',
      },
    }, 'PUT'));
    expect(saved.status).toBe(200);

    const oldResume = await resumeRepository.createOwned(userId, {
      title: '旧简历',
      language: 'zh',
      template: 'classic',
    });
    expect(oldResume).toBeTruthy();
    await resumeRepository.createSectionOwned(userId, {
      resumeId: oldResume!.id,
      type: 'personal_info',
      title: '个人信息',
      sortOrder: 0,
      content: {
        fullName: '',
        jobTitle: '保留职位',
        email: '',
        phone: '',
        location: '',
        avatar: 'data:image/png;base64,avatar',
      },
    });

    const response = await applyResumeProfile(new NextRequest(
      `https://resume.test/api/resume/${oldResume!.id}/personal-info/apply-profile`,
      {
        method: 'POST',
        headers: {
          cookie,
          origin: 'https://resume.test',
          'content-type': 'application/json',
          'x-request-id': `resume-profile-apply-${suffix}`,
        },
      },
    ), { params: Promise.resolve({ id: oldResume!.id }) });
    expect(response.status).toBe(200);
    const updated = await response.json();
    const personal = updated.sections.find((section: { type: string }) => section.type === 'personal_info');
    expect(personal?.content).toMatchObject({
      fullName: '旧简历同步姓名',
      jobTitle: 'Unity 客户端负责人',
      email: 'old-resume-owner@example.com',
      phone: '13900139000',
      location: '广州',
      yearsOfExperience: '7',
      avatar: 'data:image/png;base64,avatar',
    });
  });

  it('rejects cross-origin updates in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const response = await putSettings(new NextRequest('https://resume.test/api/user/settings', {
        method: 'PUT',
        headers: {
          cookie,
          origin: 'https://evil.test',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ resumePersonalInfo: { fullName: 'evil' } }),
      }));
      expect(response.status).toBe(401);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
