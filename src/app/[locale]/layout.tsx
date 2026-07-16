import { NextIntlClientProvider } from 'next-intl';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from '@/components/layout/theme-provider';
import { RuntimeConfigProvider } from '@/components/providers/runtime-config-provider';
import { BrandProvider } from '@/components/layout/brand-provider';
import { AuthProvider } from '@/components/providers/auth-provider';
import { isAccountAuthEnabled } from '@/lib/config';

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const authEnabled = isAccountAuthEnabled();

  if (!(routing.locales as readonly string[]).includes(locale)) {
    notFound();
  }

  const messages = (await import(`../../../messages/${locale}.json`)).default;

  return (
    <RuntimeConfigProvider authEnabled={authEnabled}>
      <NextIntlClientProvider locale={locale} messages={messages}>
        <AuthProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="light"
            enableSystem
            disableTransitionOnChange
          >
            <BrandProvider>
              <TooltipProvider>
                {children}
                <Toaster />
              </TooltipProvider>
            </BrandProvider>
          </ThemeProvider>
        </AuthProvider>
      </NextIntlClientProvider>
    </RuntimeConfigProvider>
  );
}
