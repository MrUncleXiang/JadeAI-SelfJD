import { NextRequest, NextResponse } from 'next/server';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { hasTrustedOrigin } from '@/lib/auth/http';
import { userRepository } from '@/lib/db/repositories/user.repository';
import {
  normalizeResumePersonalProfile,
  personalInfoContentFromProfile,
  resumePersonalProfileFromSettings,
} from '@/lib/user/resume-personal-profile';

const EDITOR_SETTING_KEYS = ['autoSave', 'autoSaveInterval'] as const;

function publicSettings(settings: Record<string, unknown>, user: { name: string | null; username: string | null; email: string | null }) {
  const resumePersonalInfo = normalizeResumePersonalProfile(personalInfoContentFromProfile(
    resumePersonalProfileFromSettings(settings),
    {
      displayName: user.name || user.username || null,
      email: user.email || null,
    },
  ));
  return {
    autoSave: typeof settings.autoSave === 'boolean' ? settings.autoSave : undefined,
    autoSaveInterval: typeof settings.autoSaveInterval === 'number' ? settings.autoSaveInterval : undefined,
    aiProvider: settings.aiProvider,
    aiBaseURL: settings.aiBaseURL,
    aiModel: settings.aiModel,
    resumePersonalInfo,
  };
}

export async function GET(request: NextRequest) {
  try {
    const fingerprint = getUserIdFromRequest(request);
    const user = await resolveUser(fingerprint);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const settings = await userRepository.getSettings(user.id);
    return NextResponse.json(publicSettings(settings, user));
  } catch (error) {
    console.error('GET /api/user/settings error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    if (!hasTrustedOrigin(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const fingerprint = getUserIdFromRequest(request);
    const user = await resolveUser(fingerprint);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid input', code: 'INVALID_INPUT' }, { status: 400 });
    }

    const filtered: Record<string, unknown> = {};
    for (const key of EDITOR_SETTING_KEYS) {
      if (key in body) {
        filtered[key] = (body as Record<string, unknown>)[key];
      }
    }

    if ('resumePersonalInfo' in body) {
      const raw = (body as Record<string, unknown>).resumePersonalInfo;
      if (raw != null && (typeof raw !== 'object' || Array.isArray(raw))) {
        return NextResponse.json({ error: 'Invalid resume personal info', code: 'INVALID_INPUT' }, { status: 400 });
      }
      filtered.resumePersonalInfo = normalizeResumePersonalProfile(raw);
    }

    if (Object.keys(filtered).length === 0) {
      return NextResponse.json({ error: 'No allowed settings provided', code: 'INVALID_INPUT' }, { status: 400 });
    }

    const settings = await userRepository.updateSettings(user.id, filtered);
    return NextResponse.json(publicSettings(settings, user));
  } catch (error) {
    console.error('PUT /api/user/settings error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
