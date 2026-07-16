import { and, desc, eq, gt, isNull, like, lt, or, sql } from 'drizzle-orm';

import { config } from '@/lib/config';
import { db } from '../index';
import {
  auditEvents,
  authRateLimits,
  authSessions,
  invitations,
  passwordCredentials,
  systemSettings,
  users,
} from '../schema';

export type RegistrationMode = 'closed' | 'invite' | 'open';

export class AuthRepositoryError extends Error {
  constructor(public readonly code:
    | 'INVALID_INVITATION'
    | 'IDENTIFIER_CONFLICT'
    | 'BOOTSTRAP_DISABLED'
    | 'LAST_ADMIN'
    | 'USER_NOT_FOUND'
  ) {
    super(code);
    this.name = 'AuthRepositoryError';
  }
}

interface AuditInput {
  actorUserId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  outcome: 'success' | 'failure';
  requestId?: string | null;
  metadata?: Record<string, unknown>;
}

interface CreatePasswordUserInput {
  username: string;
  usernameNormalized: string;
  email?: string | null;
  emailNormalized?: string | null;
  displayName?: string | null;
  passwordHash: string;
  role?: 'admin' | 'user';
  requireNoActiveAdmin?: boolean;
  invitationCodeHash?: string | null;
  requestId?: string | null;
}

interface UpdateProfileInput {
  displayName?: string;
  email?: string | null;
  emailNormalized?: string | null;
  requestId?: string | null;
}

function parseRegistrationMode(value: unknown): RegistrationMode | null {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = value;
    }
  }
  const mode = typeof parsed === 'object' && parsed !== null && 'mode' in parsed
    ? (parsed as { mode?: unknown }).mode
    : parsed;
  return mode === 'closed' || mode === 'invite' || mode === 'open' ? mode : null;
}

export const authRepository = {
  async findUserByLoginIdentifier(identifierNormalized: string) {
    const rows = await db
      .select()
      .from(users)
      .where(or(
        eq(users.usernameNormalized, identifierNormalized),
        eq(users.emailNormalized, identifierNormalized),
      ))
      .limit(1);
    return rows[0] ?? null;
  },

  async findCredentialByUserId(userId: string) {
    const rows = await db
      .select()
      .from(passwordCredentials)
      .where(eq(passwordCredentials.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  },

  async countActiveAdmins(): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.status, 'active'), isNull(users.deletedAt)));
    return Number(rows[0]?.count || 0);
  },

  async createPasswordUser(input: CreatePasswordUserInput) {
    const id = crypto.randomUUID();
    const userValues: typeof users.$inferInsert = {
      id,
      username: input.username,
      usernameNormalized: input.usernameNormalized,
      email: input.email || null,
      emailNormalized: input.emailNormalized || null,
      name: input.displayName || input.username,
      authType: 'password',
      role: input.role || 'user',
      status: 'active',
      tokenVersion: 0,
    };
    const auditValues: typeof auditEvents.$inferInsert = {
      id: crypto.randomUUID(),
      actorUserId: id,
      action: input.role === 'admin' ? 'auth.bootstrap_admin' : 'auth.register',
      targetType: 'user',
      targetId: id,
      outcome: 'success',
      requestId: input.requestId || null,
      metadata: {},
    };

    try {
      if (config.db.type === 'sqlite') {
        return db.transaction((tx: typeof db) => {
          if (input.requireNoActiveAdmin) {
            const admins = tx
              .select({ count: sql<number>`count(*)` })
              .from(users)
              .where(and(eq(users.role, 'admin'), eq(users.status, 'active'), isNull(users.deletedAt)))
              .get();
            if (Number(admins?.count || 0) > 0) {
              throw new AuthRepositoryError('BOOTSTRAP_DISABLED');
            }
          }

          if (input.invitationCodeHash) {
            const invitation = tx
              .select()
              .from(invitations)
              .where(and(
                eq(invitations.codeHash, input.invitationCodeHash),
                isNull(invitations.disabledAt),
              ))
              .limit(1)
              .get();
            const now = new Date();
            if (
              !invitation
              || invitation.useCount >= invitation.maxUses
              || (invitation.expiresAt && invitation.expiresAt <= now)
            ) {
              throw new AuthRepositoryError('INVALID_INVITATION');
            }

            const consumed = tx
              .update(invitations)
              .set({ useCount: sql`${invitations.useCount} + 1` })
              .where(and(
                eq(invitations.id, invitation.id),
                lt(invitations.useCount, invitations.maxUses),
                isNull(invitations.disabledAt),
                or(isNull(invitations.expiresAt), gt(invitations.expiresAt, now)),
              ))
              .returning({ id: invitations.id })
              .get();
            if (!consumed) throw new AuthRepositoryError('INVALID_INVITATION');
          }

          tx.insert(users).values(userValues).run();
          tx.insert(passwordCredentials).values({ userId: id, passwordHash: input.passwordHash }).run();
          tx.insert(auditEvents).values(auditValues).run();
          return tx.select().from(users).where(eq(users.id, id)).limit(1).get();
        });
      }

      return await db.transaction(async (tx: typeof db) => {
        if (input.requireNoActiveAdmin) {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(1247323412)`);
          const admins = await tx
            .select({ count: sql<number>`count(*)` })
            .from(users)
            .where(and(eq(users.role, 'admin'), eq(users.status, 'active'), isNull(users.deletedAt)));
          if (Number(admins[0]?.count || 0) > 0) {
            throw new AuthRepositoryError('BOOTSTRAP_DISABLED');
          }
        }

        if (input.invitationCodeHash) {
          const invitationRows = await tx
            .select()
            .from(invitations)
            .where(and(
              eq(invitations.codeHash, input.invitationCodeHash),
              isNull(invitations.disabledAt),
            ))
            .limit(1);
          const invitation = invitationRows[0];
          const now = new Date();
          if (
            !invitation
            || invitation.useCount >= invitation.maxUses
            || (invitation.expiresAt && invitation.expiresAt <= now)
          ) {
            throw new AuthRepositoryError('INVALID_INVITATION');
          }

          const consumed = await tx
            .update(invitations)
            .set({ useCount: sql`${invitations.useCount} + 1` })
            .where(and(
              eq(invitations.id, invitation.id),
              lt(invitations.useCount, invitations.maxUses),
              isNull(invitations.disabledAt),
              or(isNull(invitations.expiresAt), gt(invitations.expiresAt, now)),
            ))
            .returning({ id: invitations.id });
          if (!consumed[0]) throw new AuthRepositoryError('INVALID_INVITATION');
        }

        await tx.insert(users).values(userValues);
        await tx.insert(passwordCredentials).values({
          userId: id,
          passwordHash: input.passwordHash,
        });
        await tx.insert(auditEvents).values(auditValues);

        const rows = await tx.select().from(users).where(eq(users.id, id)).limit(1);
        return rows[0];
      });
    } catch (error) {
      if (error instanceof AuthRepositoryError) throw error;
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      if (message.includes('unique') || message.includes('duplicate')) {
        throw new AuthRepositoryError('IDENTIFIER_CONFLICT');
      }
      throw error;
    }
  },

  async createSession(input: {
    userId: string;
    tokenHash: string;
    tokenVersion: number;
    expiresAt: Date;
    userAgentHash?: string | null;
    ipPrefix?: string | null;
  }) {
    const id = crypto.randomUUID();
    await db.insert(authSessions).values({
      id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      tokenVersion: input.tokenVersion,
      expiresAt: input.expiresAt,
      userAgentHash: input.userAgentHash || null,
      ipPrefix: input.ipPrefix || null,
    });
    const rows = await db.select().from(authSessions).where(eq(authSessions.id, id)).limit(1);
    return rows[0];
  },

  async consumeRateLimit(input: {
    keyHash: string;
    scope: string;
    maxAttempts: number;
    windowMs: number;
    blockMs: number;
    now?: Date;
  }): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const now = input.now || new Date();
    const windowBoundary = new Date(now.getTime() - input.windowMs);

    const updateRecord = (
      current: typeof authRateLimits.$inferSelect | undefined,
    ): { values: typeof authRateLimits.$inferInsert; allowed: boolean; retryAfterSeconds: number } => {
      if (current?.blockedUntil && current.blockedUntil > now) {
        return {
          values: { ...current, updatedAt: now },
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((current.blockedUntil.getTime() - now.getTime()) / 1000)),
        };
      }

      const windowExpired = !current || current.windowStartedAt <= windowBoundary;
      const attemptCount = windowExpired ? 1 : current.attemptCount + 1;
      const blockedUntil = attemptCount > input.maxAttempts
        ? new Date(now.getTime() + input.blockMs)
        : null;
      return {
        values: {
          keyHash: input.keyHash,
          scope: input.scope,
          windowStartedAt: windowExpired ? now : current.windowStartedAt,
          attemptCount,
          blockedUntil,
          updatedAt: now,
        },
        allowed: blockedUntil === null,
        retryAfterSeconds: blockedUntil
          ? Math.max(1, Math.ceil(input.blockMs / 1000))
          : 0,
      };
    };

    if (config.db.type === 'sqlite') {
      return db.transaction((tx: typeof db) => {
        const current = tx.select()
          .from(authRateLimits)
          .where(eq(authRateLimits.keyHash, input.keyHash))
          .limit(1)
          .get();
        const result = updateRecord(current);
        tx.insert(authRateLimits)
          .values(result.values)
          .onConflictDoUpdate({
            target: authRateLimits.keyHash,
            set: {
              scope: result.values.scope,
              windowStartedAt: result.values.windowStartedAt,
              attemptCount: result.values.attemptCount,
              blockedUntil: result.values.blockedUntil,
              updatedAt: result.values.updatedAt,
            },
          })
          .run();
        return { allowed: result.allowed, retryAfterSeconds: result.retryAfterSeconds };
      });
    }

    return db.transaction(async (tx: typeof db) => {
      // Serialize attempts for this key across application instances without
      // persisting an identifier or IP address in plaintext.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.keyHash}))`);
      const rows = await tx.select()
        .from(authRateLimits)
        .where(eq(authRateLimits.keyHash, input.keyHash))
        .limit(1);
      const result = updateRecord(rows[0]);
      await tx.insert(authRateLimits)
        .values(result.values)
        .onConflictDoUpdate({
          target: authRateLimits.keyHash,
          set: {
            scope: result.values.scope,
            windowStartedAt: result.values.windowStartedAt,
            attemptCount: result.values.attemptCount,
            blockedUntil: result.values.blockedUntil,
            updatedAt: result.values.updatedAt,
          },
        });
      return { allowed: result.allowed, retryAfterSeconds: result.retryAfterSeconds };
    });
  },

  async resetRateLimit(keyHash: string): Promise<void> {
    await db.delete(authRateLimits).where(eq(authRateLimits.keyHash, keyHash));
  },

  async findSessionByTokenHash(tokenHash: string) {
    const rows = await db
      .select()
      .from(authSessions)
      .where(eq(authSessions.tokenHash, tokenHash))
      .limit(1);
    return rows[0] ?? null;
  },

  async touchSession(id: string, now = new Date()) {
    await db.update(authSessions).set({ lastSeenAt: now }).where(eq(authSessions.id, id));
  },

  async revokeSessionByTokenHash(tokenHash: string, now = new Date()) {
    await db
      .update(authSessions)
      .set({ revokedAt: now })
      .where(and(eq(authSessions.tokenHash, tokenHash), isNull(authSessions.revokedAt)));
  },

  async revokeAllUserSessions(userId: string, now = new Date()) {
    await db
      .update(authSessions)
      .set({ revokedAt: now })
      .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)));
  },

  async upgradePasswordHash(userId: string, passwordHash: string, now = new Date()) {
    await db
      .update(passwordCredentials)
      .set({ passwordHash, updatedAt: now })
      .where(eq(passwordCredentials.userId, userId));
  },

  async changePasswordAndRevokeSessions(userId: string, passwordHash: string, now = new Date()) {
    const auditValues: typeof auditEvents.$inferInsert = {
      id: crypto.randomUUID(),
      actorUserId: userId,
      action: 'auth.password_changed',
      targetType: 'user',
      targetId: userId,
      outcome: 'success',
      metadata: {},
    };

    if (config.db.type === 'sqlite') {
      db.transaction((tx: typeof db) => {
        tx.update(passwordCredentials)
          .set({ passwordHash, passwordChangedAt: now, updatedAt: now })
          .where(eq(passwordCredentials.userId, userId))
          .run();
        tx.update(users)
          .set({ tokenVersion: sql`${users.tokenVersion} + 1`, updatedAt: now })
          .where(eq(users.id, userId))
          .run();
        tx.update(authSessions)
          .set({ revokedAt: now })
          .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)))
          .run();
        tx.insert(auditEvents).values(auditValues).run();
      });
      return;
    }

    await db.transaction(async (tx: typeof db) => {
      await tx
        .update(passwordCredentials)
        .set({
          passwordHash,
          passwordChangedAt: now,
          updatedAt: now,
        })
        .where(eq(passwordCredentials.userId, userId));
      await tx
        .update(users)
        .set({ tokenVersion: sql`${users.tokenVersion} + 1`, updatedAt: now })
        .where(eq(users.id, userId));
      await tx
        .update(authSessions)
        .set({ revokedAt: now })
        .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)));
      await tx.insert(auditEvents).values(auditValues);
    });
  },

  async updateLastLogin(userId: string, now = new Date()) {
    await db.update(users).set({ lastLoginAt: now, updatedAt: now }).where(eq(users.id, userId));
  },

  async updateProfile(userId: string, input: UpdateProfileInput) {
    const changes: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (input.displayName !== undefined) changes.name = input.displayName;
    if (input.email !== undefined) {
      changes.email = input.email;
      changes.emailNormalized = input.emailNormalized ?? null;
    }
    const auditValues: typeof auditEvents.$inferInsert = {
      id: crypto.randomUUID(),
      actorUserId: userId,
      action: 'auth.profile_updated',
      targetType: 'user',
      targetId: userId,
      outcome: 'success',
      requestId: input.requestId || null,
      metadata: {
        changedFields: [
          ...(input.displayName !== undefined ? ['displayName'] : []),
          ...(input.email !== undefined ? ['email'] : []),
        ],
      },
    };

    try {
      if (config.db.type === 'sqlite') {
        return db.transaction((tx: typeof db) => {
          tx.update(users).set(changes).where(eq(users.id, userId)).run();
          tx.insert(auditEvents).values(auditValues).run();
          return tx.select().from(users).where(eq(users.id, userId)).limit(1).get() ?? null;
        });
      }

      return await db.transaction(async (tx: typeof db) => {
        await tx.update(users).set(changes).where(eq(users.id, userId));
        await tx.insert(auditEvents).values(auditValues);
        const rows = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
        return rows[0] ?? null;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      if (message.includes('unique') || message.includes('duplicate')) {
        throw new AuthRepositoryError('IDENTIFIER_CONFLICT');
      }
      throw error;
    }
  },

  async writeAudit(input: AuditInput) {
    await db.insert(auditEvents).values({
      id: crypto.randomUUID(),
      actorUserId: input.actorUserId || null,
      action: input.action,
      targetType: input.targetType || null,
      targetId: input.targetId || null,
      outcome: input.outcome,
      requestId: input.requestId || null,
      metadata: input.metadata || {},
    });
  },

  async getRegistrationMode(): Promise<RegistrationMode> {
    const rows = await db
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, 'registration_mode'))
      .limit(1);
    const stored = parseRegistrationMode(rows[0]?.value);
    if (stored) return stored;
    const configured = parseRegistrationMode(process.env.REGISTRATION_MODE || 'closed');
    return configured || 'closed';
  },

  async setRegistrationMode(
    mode: RegistrationMode,
    actorUserId: string | null = null,
    requestId?: string | null,
  ) {
    const settingValues: typeof systemSettings.$inferInsert = {
      key: 'registration_mode',
      value: { mode },
      updatedBy: actorUserId,
    };
    const auditValues: typeof auditEvents.$inferInsert | null = actorUserId
      ? {
          id: crypto.randomUUID(),
          actorUserId,
          action: 'admin.registration_mode_updated',
          targetType: 'system_setting',
          targetId: 'registration_mode',
          outcome: 'success',
          requestId: requestId || null,
          metadata: { mode },
        }
      : null;

    if (config.db.type === 'sqlite') {
      db.transaction((tx: typeof db) => {
        tx.insert(systemSettings)
          .values(settingValues)
          .onConflictDoUpdate({
            target: systemSettings.key,
            set: {
              value: { mode },
              updatedBy: actorUserId,
              updatedAt: new Date(),
            },
          })
          .run();
        if (auditValues) tx.insert(auditEvents).values(auditValues).run();
      });
      return;
    }

    await db.transaction(async (tx: typeof db) => {
      await tx.insert(systemSettings)
        .values(settingValues)
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: {
            value: { mode },
            updatedBy: actorUserId,
            updatedAt: new Date(),
          },
        });
      if (auditValues) await tx.insert(auditEvents).values(auditValues);
    });
  },

  async listUsers(input: {
    page: number;
    pageSize: number;
    query?: string | null;
    status?: 'active' | 'disabled' | 'pending' | null;
  }) {
    const query = input.query?.normalize('NFKC').trim().toLocaleLowerCase('en-US');
    const condition = and(
      isNull(users.deletedAt),
      input.status ? eq(users.status, input.status) : undefined,
      query
        ? or(
          like(users.usernameNormalized, `%${query}%`),
          like(users.emailNormalized, `%${query}%`),
          like(users.name, `%${query}%`),
        )
        : undefined,
    );
    const selection = {
      id: users.id,
      username: users.username,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      authType: users.authType,
      role: users.role,
      status: users.status,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    };
    const [items, countRows] = await Promise.all([
      db.select(selection)
        .from(users)
        .where(condition)
        .orderBy(desc(users.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize),
      db.select({ count: sql<number>`count(*)` }).from(users).where(condition),
    ]);
    return { items, total: Number(countRows[0]?.count || 0) };
  },

  async updateUserByAdmin(input: {
    actorUserId: string;
    targetUserId: string;
    role?: 'admin' | 'user';
    status?: 'active' | 'disabled' | 'pending';
    requestId?: string | null;
  }) {
    if (config.db.type === 'sqlite') {
      return db.transaction((tx: typeof db) => {
        const target = tx
          .select()
          .from(users)
          .where(and(eq(users.id, input.targetUserId), isNull(users.deletedAt)))
          .limit(1)
          .get();
        if (!target) throw new AuthRepositoryError('USER_NOT_FOUND');
        const removesActiveAdmin = target.role === 'admin'
          && target.status === 'active'
          && (input.role === 'user' || (input.status !== undefined && input.status !== 'active'));
        if (removesActiveAdmin) {
          const count = tx
            .select({ count: sql<number>`count(*)` })
            .from(users)
            .where(and(eq(users.role, 'admin'), eq(users.status, 'active'), isNull(users.deletedAt)))
            .get();
          if (Number(count?.count || 0) <= 1) throw new AuthRepositoryError('LAST_ADMIN');
        }

        const now = new Date();
        const updated = tx.update(users)
          .set({
            ...(input.role !== undefined ? { role: input.role } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            updatedAt: now,
          })
          .where(eq(users.id, input.targetUserId))
          .returning()
          .get();
        if (input.status === 'disabled') {
          tx.update(authSessions)
            .set({ revokedAt: now })
            .where(and(eq(authSessions.userId, input.targetUserId), isNull(authSessions.revokedAt)))
            .run();
        }
        tx.insert(auditEvents).values({
          id: crypto.randomUUID(),
          actorUserId: input.actorUserId,
          action: 'admin.user_updated',
          targetType: 'user',
          targetId: input.targetUserId,
          outcome: 'success',
          requestId: input.requestId || null,
          metadata: { role: input.role, status: input.status },
        }).run();
        return updated;
      });
    }

    return db.transaction(async (tx: typeof db) => {
      // Serialize all operations that might remove the last administrator.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(1247323412)`);
      const targetRows = await tx
        .select()
        .from(users)
        .where(and(eq(users.id, input.targetUserId), isNull(users.deletedAt)))
        .limit(1);
      const target = targetRows[0];
      if (!target) throw new AuthRepositoryError('USER_NOT_FOUND');
      const removesActiveAdmin = target.role === 'admin'
        && target.status === 'active'
        && (input.role === 'user' || (input.status !== undefined && input.status !== 'active'));
      if (removesActiveAdmin) {
        const countRows = await tx
          .select({ count: sql<number>`count(*)` })
          .from(users)
          .where(and(eq(users.role, 'admin'), eq(users.status, 'active'), isNull(users.deletedAt)));
        if (Number(countRows[0]?.count || 0) <= 1) throw new AuthRepositoryError('LAST_ADMIN');
      }

      const now = new Date();
      const updatedRows = await tx.update(users)
        .set({
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          updatedAt: now,
        })
        .where(eq(users.id, input.targetUserId))
        .returning();
      if (input.status === 'disabled') {
        await tx.update(authSessions)
          .set({ revokedAt: now })
          .where(and(eq(authSessions.userId, input.targetUserId), isNull(authSessions.revokedAt)));
      }
      await tx.insert(auditEvents).values({
        id: crypto.randomUUID(),
        actorUserId: input.actorUserId,
        action: 'admin.user_updated',
        targetType: 'user',
        targetId: input.targetUserId,
        outcome: 'success',
        requestId: input.requestId || null,
        metadata: { role: input.role, status: input.status },
      });
      return updatedRows[0];
    });
  },

  async createInvitation(input: {
    codeHash: string;
    maxUses: number;
    expiresAt?: Date | null;
    actorUserId: string;
    requestId?: string | null;
  }) {
    const id = crypto.randomUUID();
    const invitationValues: typeof invitations.$inferInsert = {
      id,
      codeHash: input.codeHash,
      maxUses: input.maxUses,
      expiresAt: input.expiresAt || null,
      createdBy: input.actorUserId,
    };
    const auditValues: typeof auditEvents.$inferInsert = {
      id: crypto.randomUUID(),
      actorUserId: input.actorUserId,
      action: 'admin.invitation_created',
      targetType: 'invitation',
      targetId: id,
      outcome: 'success',
      requestId: input.requestId || null,
      metadata: { maxUses: input.maxUses, expiresAt: input.expiresAt?.toISOString() || null },
    };

    if (config.db.type === 'sqlite') {
      return db.transaction((tx: typeof db) => {
        tx.insert(invitations).values(invitationValues).run();
        tx.insert(auditEvents).values(auditValues).run();
        return tx.select().from(invitations).where(eq(invitations.id, id)).limit(1).get();
      });
    }

    return db.transaction(async (tx: typeof db) => {
      await tx.insert(invitations).values(invitationValues);
      await tx.insert(auditEvents).values(auditValues);
      const rows = await tx.select().from(invitations).where(eq(invitations.id, id)).limit(1);
      return rows[0];
    });
  },

  async listInvitations() {
    return db.select({
      id: invitations.id,
      maxUses: invitations.maxUses,
      useCount: invitations.useCount,
      expiresAt: invitations.expiresAt,
      createdBy: invitations.createdBy,
      createdAt: invitations.createdAt,
      disabledAt: invitations.disabledAt,
    }).from(invitations).orderBy(desc(invitations.createdAt));
  },

  async disableInvitation(id: string, actorUserId: string, requestId?: string | null) {
    const now = new Date();
    const auditValues: typeof auditEvents.$inferInsert = {
      id: crypto.randomUUID(),
      actorUserId,
      action: 'admin.invitation_disabled',
      targetType: 'invitation',
      targetId: id,
      outcome: 'success',
      requestId: requestId || null,
      metadata: {},
    };

    if (config.db.type === 'sqlite') {
      return db.transaction((tx: typeof db) => {
        const disabled = tx.update(invitations)
          .set({ disabledAt: now })
          .where(and(eq(invitations.id, id), isNull(invitations.disabledAt)))
          .returning({ id: invitations.id })
          .get();
        if (!disabled) return false;
        tx.insert(auditEvents).values(auditValues).run();
        return true;
      });
    }

    return db.transaction(async (tx: typeof db) => {
      const rows = await tx.update(invitations)
        .set({ disabledAt: now })
        .where(and(eq(invitations.id, id), isNull(invitations.disabledAt)))
        .returning({ id: invitations.id });
      if (!rows[0]) return false;
      await tx.insert(auditEvents).values(auditValues);
      return true;
    });
  },
};
