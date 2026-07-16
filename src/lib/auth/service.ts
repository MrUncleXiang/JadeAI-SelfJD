import { dbReady } from '@/lib/db';
import {
  AuthRepositoryError,
  authRepository,
  type RegistrationMode,
} from '@/lib/db/repositories/auth.repository';
import { userRepository } from '@/lib/db/repositories/user.repository';
import type { users } from '@/lib/db/schema';

import { normalizeEmail, normalizeLoginIdentifier, normalizeUsername } from './identifiers';
import { hashPassword, passwordHashNeedsUpgrade, validatePassword, verifyPassword } from './password';
import { sessionExpiresAt } from './http';
import { createOpaqueToken, hashOpaqueToken, hashOptionalMetadata } from './tokens';

const DUMMY_PASSWORD_HASH = '$scrypt$ln=15,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 8;
const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_RATE_LIMIT_BLOCK_MS = 15 * 60 * 1000;
const REGISTRATION_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const REGISTRATION_RATE_LIMIT_BLOCK_MS = 60 * 60 * 1000;

type UserRecord = typeof users.$inferSelect;

export interface SafeUser {
  id: string;
  username: string | null;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  role: 'admin' | 'user';
  status: 'active' | 'disabled' | 'pending';
  authType: 'password' | 'oauth' | 'fingerprint';
}

export interface ActorContext {
  userId: string;
  role: 'admin' | 'user';
  sessionId: string;
  requestId: string;
  user: SafeUser;
}

interface SessionMetadata {
  requestId: string;
  userAgent?: string | null;
  ipPrefix?: string | null;
}

interface RegisterInput {
  username: string;
  email?: string | null;
  displayName?: string | null;
  password: string;
  invitationCode?: string | null;
}

interface LoginInput {
  identifier: string;
  password: string;
}

interface UpdateProfileInput {
  displayName?: string;
  email?: string | null;
}

export class AuthServiceError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_INPUT'
      | 'REGISTRATION_CLOSED'
      | 'INVITATION_REQUIRED'
      | 'INVALID_INVITATION'
      | 'IDENTIFIER_CONFLICT'
      | 'INVALID_CREDENTIALS'
      | 'TOO_MANY_ATTEMPTS'
      | 'INVALID_PASSWORD'
      | 'BOOTSTRAP_DISABLED'
      | 'FORBIDDEN'
      | 'USER_NOT_FOUND'
      | 'RESOURCE_NOT_FOUND'
      | 'LAST_ADMIN',
    public readonly status: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = 'AuthServiceError';
  }
}

function safeUser(user: UserRecord): SafeUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    role: user.role,
    status: user.status,
    authType: user.authType,
  };
}

function asDate(value: Date | number | string): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'number' && value < 10_000_000_000) return new Date(value * 1000);
  return new Date(value);
}

async function createSession(user: UserRecord, metadata: SessionMetadata) {
  const token = createOpaqueToken();
  const expiresAt = sessionExpiresAt();
  const session = await authRepository.createSession({
    userId: user.id,
    tokenHash: hashOpaqueToken(token),
    tokenVersion: user.tokenVersion,
    expiresAt,
    userAgentHash: hashOptionalMetadata(metadata.userAgent),
    ipPrefix: metadata.ipPrefix,
  });
  return { token, expiresAt, session, user: safeUser(user) };
}

async function auditLoginFailure(identifier: string, metadata: SessionMetadata): Promise<void> {
  await authRepository.writeAudit({
    action: 'auth.login',
    outcome: 'failure',
    requestId: metadata.requestId,
    metadata: { identifierHash: hashOpaqueToken(identifier) },
  });
}

function loginRateLimitKey(identifier: string, metadata: SessionMetadata): string {
  return hashOpaqueToken(`login\u0000${identifier}\u0000${metadata.ipPrefix || 'unknown'}`);
}

async function consumeRegistrationRateLimits(
  username: string,
  metadata: SessionMetadata,
): Promise<string> {
  const ipScope = metadata.ipPrefix || 'unknown';
  const usernameKey = hashOpaqueToken(`register-username\u0000${username}\u0000${ipScope}`);
  const limits = [
    ...(metadata.ipPrefix
      ? [{ keyHash: hashOpaqueToken(`register-ip\u0000${ipScope}`), maxAttempts: 20 }]
      : []),
    { keyHash: usernameKey, maxAttempts: 5 },
  ];
  for (const limit of limits) {
    const result = await authRepository.consumeRateLimit({
      keyHash: limit.keyHash,
      scope: 'auth.register',
      maxAttempts: limit.maxAttempts,
      windowMs: REGISTRATION_RATE_LIMIT_WINDOW_MS,
      blockMs: REGISTRATION_RATE_LIMIT_BLOCK_MS,
    });
    if (!result.allowed) {
      await authRepository.writeAudit({
        action: 'auth.registration_rate_limited',
        outcome: 'failure',
        requestId: metadata.requestId,
        metadata: { retryAfterSeconds: result.retryAfterSeconds },
      });
      throw new AuthServiceError('TOO_MANY_ATTEMPTS', 429, result.retryAfterSeconds);
    }
  }
  return usernameKey;
}

export const authService = {
  async getRegistrationMode(): Promise<RegistrationMode> {
    await dbReady;
    return authRepository.getRegistrationMode();
  },

  async register(input: RegisterInput, metadata: SessionMetadata) {
    await dbReady;
    const username = normalizeUsername(input.username);
    const registrationUsernameKey = await consumeRegistrationRateLimits(
      username?.normalized || '<invalid>',
      metadata,
    );
    const email = input.email ? normalizeEmail(input.email) : null;
    const displayName = input.displayName?.normalize('NFKC').trim() || null;
    const passwordError = validatePassword(input.password);
    if (
      !username
      || (input.email && !email)
      || (displayName && Array.from(displayName).length > 100)
      || passwordError
    ) {
      throw new AuthServiceError(passwordError ? 'INVALID_PASSWORD' : 'INVALID_INPUT', 400);
    }

    const mode = await authRepository.getRegistrationMode();
    if (mode === 'closed') throw new AuthServiceError('REGISTRATION_CLOSED', 403);
    if (mode === 'invite' && !input.invitationCode) {
      throw new AuthServiceError('INVITATION_REQUIRED', 400);
    }

    const passwordHash = await hashPassword(input.password);
    try {
      const user = await authRepository.createPasswordUser({
        username: username.value,
        usernameNormalized: username.normalized,
        email: email?.value || null,
        emailNormalized: email?.normalized || null,
        displayName,
        passwordHash,
        invitationCodeHash: input.invitationCode
          ? hashOpaqueToken(input.invitationCode.normalize('NFKC').trim())
          : null,
        requestId: metadata.requestId,
      });
      await authRepository.resetRateLimit(registrationUsernameKey);
      return createSession(user, metadata);
    } catch (error) {
      if (error instanceof AuthRepositoryError) {
        if (error.code === 'INVALID_INVITATION') {
          throw new AuthServiceError('INVALID_INVITATION', 400);
        }
        throw new AuthServiceError('IDENTIFIER_CONFLICT', 409);
      }
      throw error;
    }
  },

  async login(input: LoginInput, metadata: SessionMetadata) {
    await dbReady;
    const identifier = normalizeLoginIdentifier(input.identifier);
    const rateLimitKey = loginRateLimitKey(identifier || '<invalid>', metadata);
    const rateLimit = await authRepository.consumeRateLimit({
      keyHash: rateLimitKey,
      scope: 'auth.login',
      maxAttempts: LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
      windowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
      blockMs: LOGIN_RATE_LIMIT_BLOCK_MS,
    });
    if (!rateLimit.allowed) {
      await authRepository.writeAudit({
        action: 'auth.login_rate_limited',
        outcome: 'failure',
        requestId: metadata.requestId,
        metadata: { retryAfterSeconds: rateLimit.retryAfterSeconds },
      });
      throw new AuthServiceError('TOO_MANY_ATTEMPTS', 429, rateLimit.retryAfterSeconds);
    }
    if (!identifier || typeof input.password !== 'string' || input.password.length > 1024) {
      if (identifier) await auditLoginFailure(identifier, metadata);
      throw new AuthServiceError('INVALID_CREDENTIALS', 401);
    }

    const user = await authRepository.findUserByLoginIdentifier(identifier);
    const credential = user ? await authRepository.findCredentialByUserId(user.id) : null;
    const passwordMatches = await verifyPassword(
      input.password,
      credential?.passwordHash || DUMMY_PASSWORD_HASH,
    );
    if (!user || !credential || !passwordMatches || user.status !== 'active' || user.deletedAt) {
      await auditLoginFailure(identifier, metadata);
      throw new AuthServiceError('INVALID_CREDENTIALS', 401);
    }

    if (passwordHashNeedsUpgrade(credential.passwordHash)) {
      await authRepository.upgradePasswordHash(user.id, await hashPassword(input.password));
    }
    await authRepository.updateLastLogin(user.id);
    await authRepository.writeAudit({
      actorUserId: user.id,
      action: 'auth.login',
      targetType: 'user',
      targetId: user.id,
      outcome: 'success',
      requestId: metadata.requestId,
      metadata: {},
    });
    await authRepository.resetRateLimit(rateLimitKey);
    return createSession(user, metadata);
  },

  async resolveSession(token: string | null, requestId = crypto.randomUUID()): Promise<ActorContext | null> {
    await dbReady;
    if (!token || token.length < 32 || token.length > 512) return null;
    const tokenHash = hashOpaqueToken(token);
    const session = await authRepository.findSessionByTokenHash(tokenHash);
    if (!session || session.revokedAt || asDate(session.expiresAt) <= new Date()) return null;

    const user = await userRepository.findById(session.userId);
    if (
      !user
      || user.status !== 'active'
      || user.deletedAt
      || session.tokenVersion !== user.tokenVersion
    ) {
      await authRepository.revokeSessionByTokenHash(tokenHash);
      return null;
    }

    if (Date.now() - asDate(session.lastSeenAt).getTime() >= SESSION_TOUCH_INTERVAL_MS) {
      await authRepository.touchSession(session.id);
    }
    return {
      userId: user.id,
      role: user.role,
      sessionId: session.id,
      requestId,
      user: safeUser(user),
    };
  },

  async logout(token: string | null): Promise<void> {
    await dbReady;
    if (!token) return;
    const tokenHash = hashOpaqueToken(token);
    const session = await authRepository.findSessionByTokenHash(tokenHash);
    await authRepository.revokeSessionByTokenHash(tokenHash);
    if (session) {
      await authRepository.writeAudit({
        actorUserId: session.userId,
        action: 'auth.logout',
        targetType: 'session',
        targetId: session.id,
        outcome: 'success',
        metadata: {},
      });
    }
  },

  async updateProfile(userId: string, input: UpdateProfileInput, requestId?: string): Promise<SafeUser> {
    await dbReady;
    if (input.displayName === undefined && input.email === undefined) {
      throw new AuthServiceError('INVALID_INPUT', 400);
    }
    const displayName = input.displayName?.normalize('NFKC').trim();
    if (
      input.displayName !== undefined
      && (!displayName || Array.from(displayName).length > 100)
    ) {
      throw new AuthServiceError('INVALID_INPUT', 400);
    }
    const email = input.email === null || input.email === undefined
      ? null
      : normalizeEmail(input.email);
    if (input.email !== undefined && input.email !== null && !email) {
      throw new AuthServiceError('INVALID_INPUT', 400);
    }

    try {
      const user = await authRepository.updateProfile(userId, {
        ...(input.displayName !== undefined ? { displayName } : {}),
        ...(input.email !== undefined
          ? { email: email?.value || null, emailNormalized: email?.normalized || null }
          : {}),
        requestId,
      });
      if (!user) throw new AuthServiceError('INVALID_INPUT', 404);
      return safeUser(user);
    } catch (error) {
      if (error instanceof AuthRepositoryError) {
        throw new AuthServiceError('IDENTIFIER_CONFLICT', 409);
      }
      throw error;
    }
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    await dbReady;
    const credential = await authRepository.findCredentialByUserId(userId);
    if (!credential || !(await verifyPassword(currentPassword, credential.passwordHash))) {
      throw new AuthServiceError('INVALID_CREDENTIALS', 401);
    }
    const passwordError = validatePassword(newPassword);
    if (passwordError) throw new AuthServiceError('INVALID_PASSWORD', 400);
    await authRepository.changePasswordAndRevokeSessions(userId, await hashPassword(newPassword));
  },

  async bootstrapAdmin(input: Omit<RegisterInput, 'invitationCode'>) {
    await dbReady;
    const username = normalizeUsername(input.username);
    const email = input.email ? normalizeEmail(input.email) : null;
    const displayName = input.displayName?.normalize('NFKC').trim() || username?.value || null;
    const passwordError = validatePassword(input.password);
    if (
      !username
      || (input.email && !email)
      || !displayName
      || Array.from(displayName).length > 100
      || passwordError
    ) {
      throw new AuthServiceError(passwordError ? 'INVALID_PASSWORD' : 'INVALID_INPUT', 400);
    }
    try {
      return await authRepository.createPasswordUser({
        username: username.value,
        usernameNormalized: username.normalized,
        email: email?.value || null,
        emailNormalized: email?.normalized || null,
        displayName,
        passwordHash: await hashPassword(input.password),
        role: 'admin',
        requireNoActiveAdmin: true,
      });
    } catch (error) {
      if (error instanceof AuthRepositoryError) {
        if (error.code === 'BOOTSTRAP_DISABLED') {
          throw new AuthServiceError('BOOTSTRAP_DISABLED', 409);
        }
        throw new AuthServiceError('IDENTIFIER_CONFLICT', 409);
      }
      throw error;
    }
  },
};
