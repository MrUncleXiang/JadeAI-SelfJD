'use client';

import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, Loader2 } from 'lucide-react';

import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function safeCallbackUrl(value: string | null, locale: string): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return `/${locale}/dashboard`;
  return value;
}

export function LoginForm() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorCode(null);
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
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

  const errorMessage = errorCode === 'INVALID_CREDENTIALS'
    ? t('invalidCredentials')
    : errorCode === 'TOO_MANY_ATTEMPTS'
      ? t('tooManyAttempts')
      : errorCode
        ? t('requestFailed')
        : null;
  const passwordChanged = searchParams.get('passwordChanged') === '1';

  return (
    <div className="w-full">
      <form className="space-y-4" onSubmit={onSubmit}>
        {passwordChanged && (
          <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            {t('passwordChanged')}
          </p>
        )}
        <div className="space-y-2">
          <Label htmlFor="identifier">{t('identifier')}</Label>
          <Input
            id="identifier"
            name="identifier"
            autoComplete="username"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            maxLength={254}
            required
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">{t('password')}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            maxLength={1024}
            required
          />
        </div>
        {errorMessage && (
          <p role="alert" className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {errorMessage}
          </p>
        )}
        <Button type="submit" disabled={isSubmitting} className="h-11 w-full bg-brand text-white hover:bg-brand-hover">
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('login')}
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {t('noAccount')}{' '}
        <Link href="/register" className="font-medium text-brand hover:underline">
          {t('register')}
        </Link>
      </p>
    </div>
  );
}
