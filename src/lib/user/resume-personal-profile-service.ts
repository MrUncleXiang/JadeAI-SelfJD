import { userRepository } from '@/lib/db/repositories/user.repository';

import {
  resumePersonalProfileFromSettings,
  type ResumePersonalProfile,
} from './resume-personal-profile';

export async function loadResumePersonalProfile(userId: string): Promise<{
  profile: ResumePersonalProfile;
  fallback: { displayName: string | null; email: string | null };
}> {
  const [settings, user] = await Promise.all([
    userRepository.getSettings(userId),
    userRepository.findById(userId),
  ]);
  return {
    profile: resumePersonalProfileFromSettings(settings),
    fallback: {
      displayName: user?.name || user?.username || null,
      email: user?.email || null,
    },
  };
}
