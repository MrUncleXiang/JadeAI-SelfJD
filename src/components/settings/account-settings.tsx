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
import {
  EMPTY_RESUME_PERSONAL_PROFILE,
  type ResumePersonalProfile,
  normalizeResumePersonalProfile,
} from '@/lib/user/resume-personal-profile';

interface ApiErrorBody {
  code?: string;
}

function getFingerprint(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('jade_fingerprint');
}

export function AccountSettings() {
  const t = useTranslations('settings.account');
  const locale = useLocale();
  const { user, refresh } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [resumeProfile, setResumeProfile] = useState<ResumePersonalProfile>(EMPTY_RESUME_PERSONAL_PROFILE);
  const [resumeProfileLoading, setResumeProfileLoading] = useState(false);
  const [resumeProfileSaving, setResumeProfileSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);

  useEffect(() => {
    setDisplayName(user?.name || '');
    setEmail(user?.email || '');
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setResumeProfileLoading(true);
    const fingerprint = getFingerprint();
    void fetch('/api/user/settings', {
      credentials: 'same-origin',
      headers: {
        ...(fingerprint ? { 'x-fingerprint': fingerprint } : {}),
      },
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('load failed');
        const data = await response.json();
        if (!cancelled) {
          setResumeProfile(normalizeResumePersonalProfile(data.resumePersonalInfo));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResumeProfile(EMPTY_RESUME_PERSONAL_PROFILE);
        }
      })
      .finally(() => {
        if (!cancelled) setResumeProfileLoading(false);
      });
    return () => {
      cancelled = true;
    };
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

  async function saveResumeProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResumeProfileSaving(true);
    try {
      const fingerprint = getFingerprint();
      const response = await fetch('/api/user/settings', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          ...(fingerprint ? { 'x-fingerprint': fingerprint } : {}),
        },
        body: JSON.stringify({
          resumePersonalInfo: normalizeResumePersonalProfile(resumeProfile),
        }),
      });
      if (!response.ok) {
        toast.error(t('saveFailed'));
        return;
      }
      const data = await response.json();
      setResumeProfile(normalizeResumePersonalProfile(data.resumePersonalInfo));
      toast.success(t('resumeProfileSaved'));
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setResumeProfileSaving(false);
    }
  }

  function updateResumeField<K extends keyof ResumePersonalProfile>(key: K, value: string) {
    setResumeProfile((current) => ({ ...current, [key]: value }));
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

  const resumeFields: Array<{ key: keyof ResumePersonalProfile; label: string; type?: string; maxLength?: number }> = [
    { key: 'fullName', label: t('resumeFullName') },
    { key: 'jobTitle', label: t('resumeJobTitle') },
    { key: 'email', label: t('resumeEmail'), type: 'email', maxLength: 254 },
    { key: 'phone', label: t('resumePhone') },
    { key: 'wechat', label: t('resumeWechat') },
    { key: 'location', label: t('resumeLocation') },
    { key: 'website', label: t('resumeWebsite') },
    { key: 'linkedin', label: t('resumeLinkedin') },
    { key: 'github', label: t('resumeGithub') },
    { key: 'yearsOfExperience', label: t('resumeYearsOfExperience') },
    { key: 'educationLevel', label: t('resumeEducationLevel') },
    { key: 'age', label: t('resumeAge') },
    { key: 'gender', label: t('resumeGender') },
    { key: 'hometown', label: t('resumeHometown') },
  ];

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

      <Separator />

      <form className="space-y-4" onSubmit={saveResumeProfile}>
        <div>
          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('resumeProfileTitle')}</h3>
          <p className="mt-1 text-xs text-zinc-500">{t('resumeProfileDescription')}</p>
        </div>
        {resumeProfileLoading ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('resumeProfileLoading')}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {resumeFields.map(({ key, label, type, maxLength }) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={`resume-${key}`}>{label}</Label>
                <Input
                  id={`resume-${key}`}
                  type={type || 'text'}
                  value={resumeProfile[key]}
                  onChange={(event) => updateResumeField(key, event.target.value)}
                  maxLength={maxLength || 300}
                />
              </div>
            ))}
          </div>
        )}
        <Button type="submit" disabled={resumeProfileLoading || resumeProfileSaving}>
          {resumeProfileSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('saveResumeProfile')}
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
