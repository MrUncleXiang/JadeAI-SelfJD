'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

interface ApiErrorBody {
  code?: string;
}

export function AccountSettings() {
  const t = useTranslations('settings.account');
  const locale = useLocale();
  const { user, refresh } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);

  useEffect(() => {
    setDisplayName(user?.name || '');
    setEmail(user?.email || '');
  }, [user]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileSaving(true);
    try {
      const response = await fetch('/api/me', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName,
          email: email.trim() || null,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as ApiErrorBody | null;
        toast.error(body?.code === 'IDENTIFIER_CONFLICT' ? t('emailConflict') : t('saveFailed'));
        return;
      }
      await refresh();
      toast.success(t('profileSaved'));
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setProfileSaving(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error(t('passwordMismatch'));
      return;
    }
    setPasswordSaving(true);
    try {
      const response = await fetch('/api/me/password', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as ApiErrorBody | null;
        const message = body?.code === 'INVALID_CREDENTIALS'
          ? t('currentPasswordInvalid')
          : body?.code === 'INVALID_PASSWORD'
            ? t('passwordPolicy')
            : t('saveFailed');
        toast.error(message);
        return;
      }
      window.location.assign(`/${locale}/login?passwordChanged=1`);
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setPasswordSaving(false);
    }
  }

  if (!user) return null;

  return (
    <div className="space-y-6">
      <form className="space-y-4" onSubmit={saveProfile}>
        <div>
          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('profileTitle')}</h3>
          <p className="mt-1 text-xs text-zinc-500">{t('profileDescription')}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="account-username">{t('username')}</Label>
          <Input id="account-username" value={user.username || ''} readOnly disabled />
        </div>
        <div className="space-y-2">
          <Label htmlFor="account-display-name">{t('displayName')}</Label>
          <Input
            id="account-display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            minLength={1}
            maxLength={100}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="account-email">{t('email')}</Label>
          <Input
            id="account-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={254}
            placeholder={t('emailOptional')}
          />
        </div>
        <Button type="submit" disabled={profileSaving}>
          {profileSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('saveProfile')}
        </Button>
      </form>

      {user.authType === 'password' && (
        <>
          <Separator />
          <form className="space-y-4" onSubmit={changePassword}>
            <div>
              <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('passwordTitle')}</h3>
              <p className="mt-1 text-xs text-zinc-500">{t('passwordDescription')}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="current-password">{t('currentPassword')}</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                maxLength={1024}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">{t('newPassword')}</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                minLength={12}
                maxLength={256}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">{t('confirmPassword')}</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={12}
                maxLength={256}
                required
              />
            </div>
            <Button type="submit" variant="outline" disabled={passwordSaving}>
              {passwordSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('changePassword')}
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
