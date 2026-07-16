import { Suspense } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';

import { RegisterForm } from '@/components/auth/register-form';
import { Separator } from '@/components/ui/separator';

export default function RegisterPage() {
  const t = useTranslations('auth');

  return (
    <div className="flex flex-col items-center">
      <div className="mb-6">
        <Image src="/logo-icon.svg" alt="JadeAI" width={48} height={48} className="drop-shadow-sm" />
      </div>
      <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        {t('createAccount')}
      </h1>
      <p className="mt-1.5 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {t('registerDescription')}
      </p>
      <Separator className="my-6" />
      <Suspense fallback={null}>
        <RegisterForm />
      </Suspense>
      <p className="mt-6 text-center text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
        {t('agreeTerms')}
      </p>
    </div>
  );
}
