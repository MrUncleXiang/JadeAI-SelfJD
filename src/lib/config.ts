export function isAccountAuthEnabled(
  value = process.env.AUTH_ENABLED,
  nodeEnv = process.env.NODE_ENV,
): boolean {
  // Account auth is the safe default for this fork. The legacy fingerprint
  // mode can only be selected explicitly during local development or tests.
  return nodeEnv === 'production' || value !== 'false';
}

export function isPublicLandingPageEnabled(
  value = process.env.PUBLIC_LANDING_PAGE,
): boolean {
  // Keep the upstream marketing page available by default, while allowing a
  // private self-hosted instance to require login before rendering any page.
  return value !== 'false';
}

export const config = {
  auth: {
    enabled: isAccountAuthEnabled(),
    fingerprintEnabled:
      process.env.AUTH_ENABLED === 'false'
      && process.env.NODE_ENV !== 'production'
      && process.env.ENABLE_FINGERPRINT_AUTH === 'true',
  },
  db: {
    type: (process.env.DB_TYPE || 'sqlite') as 'postgresql' | 'sqlite',
  },
  i18n: {
    defaultLocale: 'zh' as const,
    locales: ['zh', 'en'] as const,
  },
};
