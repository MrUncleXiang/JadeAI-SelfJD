import type { SafeUser } from './service';

type AdminUserRecord = SafeUser & {
  createdAt?: Date | string | number;
  lastLoginAt?: Date | string | number | null;
};

function dateTime(value: Date | string | number | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' && value < 10_000_000_000) return new Date(value * 1000).toISOString();
  return new Date(value).toISOString();
}

export function toAdminUser(user: AdminUserRecord) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.name || user.username || '',
    avatarUrl: user.avatarUrl,
    authType: user.authType,
    role: user.role,
    status: user.status,
    createdAt: dateTime(user.createdAt),
    lastLoginAt: dateTime(user.lastLoginAt),
  };
}

export function toInvitation(invitation: {
  id: string;
  maxUses: number;
  useCount: number;
  expiresAt: Date | number | string | null;
  createdBy: string | null;
  createdAt: Date | number | string;
  disabledAt: Date | number | string | null;
}) {
  return {
    id: invitation.id,
    maxUses: invitation.maxUses,
    useCount: invitation.useCount,
    expiresAt: dateTime(invitation.expiresAt),
    createdBy: invitation.createdBy,
    createdAt: dateTime(invitation.createdAt),
    disabledAt: dateTime(invitation.disabledAt),
  };
}
