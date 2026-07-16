'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, Loader2 } from 'lucide-react';

import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type RegistrationMode = 'closed' | 'invite' | 'open';

function safeCallbackUrl(value: string | null, locale: string): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return `/${locale}/dashboard`;
  return value;
}

function getRegistrationErrorMessage(
  code: string | null,
  translate: (key: string) => string,
): string | null {
  switch (code) {
    case 'IDENTIFIER_CONFLICT':
      return translate('identifierConflict');
    case 'INVALID_INVITATION':
    case 'INVITATION_REQUIRED':
      return translate('invalidInvitation');
    case 'INVALID_PASSWORD':
      return translate('invalidPassword');
    case 'TOO_MANY_ATTEMPTS':
      return translate('tooManyAttempts');
    case null:
      return null;
    default:
      return translate('requestFailed');
  }
}

export function RegisterForm() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<RegistrationMode | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch('/api/auth/register', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('registration mode unavailable');
        return response.json() as Promise<{ mode: RegistrationMode }>;
      })
      .then((body) => setMode(body.mode))
      .catch(() => setErrorCode('INTERNAL_ERROR'));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorCode(null);
    setIsSubmitting(true);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: data.get('username'),
          displayName: data.get('displayName') || undefined,
          email: data.get('email') || undefined,
          password: data.get('password'),
          invitationCode: data.get('invitationCode') || undefined,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { code?: string } | null;
        setErrorCode(body?.code || 'INTERNAL_ERROR');
        return;
      }
      window.location.assign(safeCallbackUrl(searchParams.get('callbackUrl'), locale));
    } catch {
      setErrorCode('INTERNAL_ERROR');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (mode === null && !errorCode) {
    return <Loader2 className="mx-auto h-5 w-5 animate-spin text-zinc-400" aria-label={t('loading')} />;
  }

  if (mode === 'closed') {
    return (
      <div className="w-full text-center">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{t('registrationClosed')}</p>
        <Link href="/login" className="mt-4 inline-block text-sm font-medium text-brand hover:underline">
          {t('backToLogin')}
        </Link>
      </div>
    );
  }

  const errorMessage = getRegistrationErrorMessage(errorCode, t);

  return (
    <div className="w-full">
      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="space-y-2">
          <Label htmlFor="username">{t('username')}</Label>
          <Input id="username" name="username" autoComplete="username" minLength={3} maxLength={32} required autoFocus />
        </div>
        <div className="space-y-2">
          <Label htmlFor="displayName">{t('displayNameOptional')}</Label>
          <Input id="displayName" name="displayName" autoComplete="name" maxLength={100} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">{t('emailOptional')}</Label>
          <Input id="email" name="email" type="email" autoComplete="email" maxLength={254} />
        </div>
        {mode === 'invite' && (
          <div className="space-y-2">
            <Label htmlFor="invitationCode">{t('invitationCode')}</Label>
            <Input id="invitationCode" name="invitationCode" autoComplete="off" maxLength={512} required />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="password">{t('password')}</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={256} required />
          <p className="text-xs text-zinc-400">{t('passwordHint')}</p>
        </div>
        {errorMessage && (
          <p role="alert" className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {errorMessage}
          </p>
        )}
        <Button type="submit" disabled={isSubmitting || !!errorCode && mode === null} className="h-11 w-full bg-brand text-white hover:bg-brand-hover">
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('register')}
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {t('hasAccount')}{' '}
        <Link href="/login" className="font-medium text-brand hover:underline">{t('login')}</Link>
      </p>
    </div>
  );
}
