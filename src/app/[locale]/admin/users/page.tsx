'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Copy, Loader2, RefreshCw, ShieldCheck, Ticket, UserCog } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/use-auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type UserRole = 'admin' | 'user';
type UserStatus = 'active' | 'disabled' | 'pending';
type RegistrationMode = 'closed' | 'invite' | 'open';

interface AdminUser {
  id: string;
  username: string | null;
  email: string | null;
  displayName: string;
  authType: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string | null;
  lastLoginAt: string | null;
}

interface Invitation {
  id: string;
  maxUses: number;
  useCount: number;
  expiresAt: string | null;
  createdAt: string | null;
  disabledAt: string | null;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { code?: string } | null;
    throw new Error(body?.code || `HTTP_${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export default function AdminUsersPage() {
  const t = useTranslations('admin');
  const { user, isLoading: authLoading } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [registrationMode, setRegistrationMode] = useState<RegistrationMode>('closed');
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [maxUses, setMaxUses] = useState('1');
  const [expiresInDays, setExpiresInDays] = useState('7');

  const load = useCallback(async () => {
    if (user?.role !== 'admin') return;
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '100' });
      if (query.trim()) params.set('query', query.trim());
      const [userResult, registration, invitationResult] = await Promise.all([
        api<{ items: AdminUser[] }>(`/api/admin/users?${params}`),
        api<{ mode: RegistrationMode }>('/api/admin/registration'),
        api<Invitation[]>('/api/admin/invitations'),
      ]);
      setUsers(userResult.items);
      setRegistrationMode(registration.mode);
      setInvitations(invitationResult);
    } catch (error) {
      toast.error(t('requestFailed'), { description: error instanceof Error ? error.message : undefined });
    } finally {
      setIsLoading(false);
    }
  }, [query, t, user?.role]);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateUser(userId: string, changes: { role?: UserRole; status?: UserStatus }) {
    try {
      const updated = await api<AdminUser>(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify(changes),
      });
      setUsers((current) => current.map((item) => item.id === userId ? updated : item));
      toast.success(t('userUpdated'));
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      toast.error(code === 'LAST_ADMIN' ? t('lastAdmin') : t('requestFailed'));
    }
  }

  async function updateRegistrationMode(mode: RegistrationMode) {
    try {
      await api('/api/admin/registration', {
        method: 'PATCH',
        body: JSON.stringify({ mode }),
      });
      setRegistrationMode(mode);
      toast.success(t('registrationUpdated'));
    } catch {
      toast.error(t('requestFailed'));
    }
  }

  async function createInvitation() {
    try {
      const result = await api<Invitation & { code: string }>('/api/admin/invitations', {
        method: 'POST',
        body: JSON.stringify({
          maxUses: Number(maxUses),
          expiresInDays: expiresInDays ? Number(expiresInDays) : null,
        }),
      });
      setCreatedCode(result.code);
      setInvitations((current) => [result, ...current]);
      toast.success(t('invitationCreated'));
    } catch {
      toast.error(t('requestFailed'));
    }
  }

  async function disableInvitation(invitationId: string) {
    try {
      await api(`/api/admin/invitations/${invitationId}`, { method: 'DELETE' });
      setInvitations((current) => current.map((item) => (
        item.id === invitationId ? { ...item, disabledAt: new Date().toISOString() } : item
      )));
      toast.success(t('invitationDisabled'));
    } catch {
      toast.error(t('requestFailed'));
    }
  }

  if (authLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (user?.role !== 'admin') {
    return (
      <div className="rounded-xl border bg-white p-10 text-center dark:bg-zinc-900">
        <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-zinc-400" />
        <h1 className="text-lg font-semibold">{t('forbidden')}</h1>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><UserCog className="h-6 w-6" />{t('title')}</h1>
          <p className="mt-1 text-sm text-zinc-500">{t('description')}</p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={isLoading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />{t('refresh')}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('registrationTitle')}</CardTitle>
            <CardDescription>{t('registrationDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={registrationMode} onValueChange={(value) => void updateRegistrationMode(value as RegistrationMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="closed">{t('modeClosed')}</SelectItem>
                <SelectItem value="invite">{t('modeInvite')}</SelectItem>
                <SelectItem value="open">{t('modeOpen')}</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Ticket className="h-5 w-5" />{t('invitationTitle')}</CardTitle>
            <CardDescription>{t('invitationDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="maxUses">{t('maxUses')}</Label>
                <Input id="maxUses" type="number" min={1} max={1000} value={maxUses} onChange={(event) => setMaxUses(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expiresInDays">{t('expiresInDays')}</Label>
                <Input id="expiresInDays" type="number" min={1} max={365} value={expiresInDays} onChange={(event) => setExpiresInDays(event.target.value)} />
              </div>
            </div>
            <Button onClick={() => void createInvitation()}>{t('createInvitation')}</Button>
            {createdCode && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
                <p className="mb-2 text-xs text-amber-700 dark:text-amber-300">{t('copyInvitationNow')}</p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all text-sm">{createdCode}</code>
                  <Button size="icon-sm" variant="outline" onClick={() => void navigator.clipboard.writeText(createdCode)} aria-label={t('copy')}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('usersTitle')}</CardTitle>
          <CardDescription>{t('usersDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t('searchPlaceholder')}
              onKeyDown={(event) => event.key === 'Enter' && setQuery(searchInput.trim())}
            />
            <Button variant="outline" onClick={() => setQuery(searchInput.trim())}>{t('search')}</Button>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[780px] text-sm">
              <thead className="bg-zinc-50 text-left dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-3 font-medium">{t('user')}</th>
                  <th className="px-4 py-3 font-medium">{t('authType')}</th>
                  <th className="px-4 py-3 font-medium">{t('role')}</th>
                  <th className="px-4 py-3 font-medium">{t('status')}</th>
                  <th className="px-4 py-3 font-medium">{t('lastLogin')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {users.map((item) => (
                  <tr key={item.id} className="bg-white dark:bg-zinc-950">
                    <td className="px-4 py-3">
                      <div className="font-medium">{item.displayName || item.username}</div>
                      <div className="text-xs text-zinc-500">@{item.username || '—'} · {item.email || '—'}</div>
                    </td>
                    <td className="px-4 py-3"><Badge variant="outline">{item.authType}</Badge></td>
                    <td className="px-4 py-3">
                      <Select value={item.role} onValueChange={(value) => void updateUser(item.id, { role: value as UserRole })}>
                        <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="user">{t('roleUser')}</SelectItem>
                          <SelectItem value="admin">{t('roleAdmin')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-4 py-3">
                      <Select value={item.status} onValueChange={(value) => void updateUser(item.id, { status: value as UserStatus })}>
                        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">{t('statusActive')}</SelectItem>
                          <SelectItem value="disabled">{t('statusDisabled')}</SelectItem>
                          <SelectItem value="pending">{t('statusPending')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-4 py-3 text-zinc-500">
                      {item.lastLoginAt ? new Date(item.lastLoginAt).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
                {!isLoading && users.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-zinc-500">{t('noUsers')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('invitationsTitle')}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {invitations.map((invitation) => (
            <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
              <div>
                <div>{t('usage', { used: invitation.useCount, max: invitation.maxUses })}</div>
                <div className="text-xs text-zinc-500">
                  {invitation.expiresAt ? t('expiresAt', { date: new Date(invitation.expiresAt).toLocaleString() }) : t('neverExpires')}
                </div>
              </div>
              {invitation.disabledAt
                ? <Badge variant="secondary">{t('disabled')}</Badge>
                : <Button size="sm" variant="outline" onClick={() => void disableInvitation(invitation.id)}>{t('disable')}</Button>}
            </div>
          ))}
          {invitations.length === 0 && <p className="py-6 text-center text-sm text-zinc-500">{t('noInvitations')}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
