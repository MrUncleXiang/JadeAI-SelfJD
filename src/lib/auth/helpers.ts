import { cookies } from 'next/headers';
import { config } from '@/lib/config';
import { dbReady } from '@/lib/db';
import { userRepository } from '@/lib/db/repositories/user.repository';
import { SESSION_COOKIE_NAME, readSessionToken } from './http';
import { authService } from './service';

export async function getCurrentUserId(): Promise<string | null> {
  if (config.auth.enabled) {
    const cookieStore = await cookies();
    const actor = await authService.resolveSession(cookieStore.get(SESSION_COOKIE_NAME)?.value || null);
    return actor?.userId || null;
  }
  // In fingerprint mode, userId is resolved from the request header
  return null;
}

export async function resolveUser(credential?: string | null) {
  // Ensure DB tables exist before any query
  await dbReady;

  if (config.auth.enabled) {
    if (!credential) return null;
    const actor = await authService.resolveSession(credential);
    return actor ? userRepository.findById(actor.userId) : null;
  }

  if (!config.auth.fingerprintEnabled || !credential) return null;
  return userRepository.upsertByFingerprint(credential);
}

export function getUserIdFromRequest(request: Request): string | null {
  if (config.auth.enabled) return readSessionToken(request);
  if (!config.auth.fingerprintEnabled) return null;
  return request.headers.get('x-fingerprint') || null;
}
