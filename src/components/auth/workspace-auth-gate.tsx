'use client';

import { LogIn, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/use-auth';
import { useRuntimeConfig } from '@/components/providers/runtime-config-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Page-level auth UX for the optional-login mode. It deliberately does not
 * redirect: anonymous visitors see a stable page and a direct login action,
 * while tenant-scoped APIs remain protected by the session cookie.
 */
export function WorkspaceAuthGate({ children }: { children: React.ReactNode }) {
  const t = useTranslations('auth');
  const { authEnabled } = useRuntimeConfig();
  const { isAuthenticated, isLoading, signIn } = useAuth();

  if (!authEnabled || isAuthenticated) return <>{children}</>;

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label={t('loading')}>
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>{t('signInRequired')}</CardTitle>
          <CardDescription>{t('signInRequiredDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={signIn} className="cursor-pointer gap-2">
            <LogIn className="h-4 w-4" />
            {t('login')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
