import { dbReady } from '@/lib/db';
import {
  AuthRepositoryError,
  authRepository,
  type RegistrationMode,
} from '@/lib/db/repositories/auth.repository';

import { AuthServiceError, type ActorContext } from './service';
import { createOpaqueToken, hashOpaqueToken } from './tokens';

function requireAdmin(actor: ActorContext): void {
  if (actor.role !== 'admin') throw new AuthServiceError('FORBIDDEN', 403);
}

export const adminAuthService = {
  async listUsers(actor: ActorContext, input: {
    page?: number;
    pageSize?: number;
    query?: string | null;
    status?: 'active' | 'disabled' | 'pending' | null;
  }) {
    await dbReady;
    requireAdmin(actor);
    const page = Math.max(1, Math.trunc(input.page || 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(input.pageSize || 20)));
    return authRepository.listUsers({ ...input, page, pageSize });
  },

  async updateUser(actor: ActorContext, targetUserId: string, input: {
    role?: 'admin' | 'user';
    status?: 'active' | 'disabled' | 'pending';
  }) {
    await dbReady;
    requireAdmin(actor);
    if (!targetUserId || (input.role === undefined && input.status === undefined)) {
      throw new AuthServiceError('INVALID_INPUT', 400);
    }
    try {
      const user = await authRepository.updateUserByAdmin({
        actorUserId: actor.userId,
        targetUserId,
        role: input.role,
        status: input.status,
        requestId: actor.requestId,
      });
      if (!user) throw new AuthServiceError('USER_NOT_FOUND', 404);
      return user;
    } catch (error) {
      if (error instanceof AuthRepositoryError) {
        if (error.code === 'LAST_ADMIN') throw new AuthServiceError('LAST_ADMIN', 409);
        if (error.code === 'USER_NOT_FOUND') throw new AuthServiceError('USER_NOT_FOUND', 404);
      }
      throw error;
    }
  },

  async getRegistrationMode(actor: ActorContext): Promise<RegistrationMode> {
    await dbReady;
    requireAdmin(actor);
    return authRepository.getRegistrationMode();
  },

  async setRegistrationMode(actor: ActorContext, mode: RegistrationMode): Promise<void> {
    await dbReady;
    requireAdmin(actor);
    await authRepository.setRegistrationMode(mode, actor.userId, actor.requestId);
  },

  async createInvitation(actor: ActorContext, input: {
    maxUses?: number;
    expiresInDays?: number | null;
  }) {
    await dbReady;
    requireAdmin(actor);
    const maxUses = Math.trunc(input.maxUses || 1);
    if (maxUses < 1 || maxUses > 1000) throw new AuthServiceError('INVALID_INPUT', 400);
    const expiresInDays = input.expiresInDays == null ? null : Math.trunc(input.expiresInDays);
    if (expiresInDays !== null && (expiresInDays < 1 || expiresInDays > 365)) {
      throw new AuthServiceError('INVALID_INPUT', 400);
    }
    const code = createOpaqueToken(24);
    const expiresAt = expiresInDays === null
      ? null
      : new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    const invitation = await authRepository.createInvitation({
      codeHash: hashOpaqueToken(code),
      maxUses,
      expiresAt,
      actorUserId: actor.userId,
      requestId: actor.requestId,
    });
    return { invitation, code };
  },

  async listInvitations(actor: ActorContext) {
    await dbReady;
    requireAdmin(actor);
    return authRepository.listInvitations();
  },

  async disableInvitation(actor: ActorContext, invitationId: string): Promise<boolean> {
    await dbReady;
    requireAdmin(actor);
    if (!invitationId) throw new AuthServiceError('INVALID_INPUT', 400);
    const disabled = await authRepository.disableInvitation(invitationId, actor.userId, actor.requestId);
    if (!disabled) throw new AuthServiceError('RESOURCE_NOT_FOUND', 404);
    return true;
  },
};
