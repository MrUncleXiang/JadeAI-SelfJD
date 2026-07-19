import { NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { isAccountAuthEnabled, isLoginRequired, isPublicLandingPageEnabled } from './lib/config';

const intlMiddleware = createMiddleware(routing);

// Public paths that don't require authentication (relative to locale prefix)
const PUBLIC_PATHS = [
  '/login',   // Login page
  '/register', // Registration page (availability is enforced by the API)
  '/share',   // Public share links
];

function isPublicPath(pathname: string): boolean {
  // Strip locale prefix: /zh/dashboard -> /dashboard, /en/ -> /
  const withoutLocale = pathname.replace(/^\/(zh|en)/, '') || '/';
  if (withoutLocale === '/') return isPublicLandingPageEnabled();
  return PUBLIC_PATHS.some((p) => withoutLocale.startsWith(p));
}

export default async function middleware(request: NextRequest) {
  // Always run i18n middleware first
  const response = intlMiddleware(request);

  // Account authentication protects APIs and personal data. Page-level login
  // redirects are opt-in so an unauthenticated visitor can still reach a
  // clear sign-in prompt and find the login entry from the shared header.
  const authEnabled = isAccountAuthEnabled();
  if (!authEnabled || !isLoginRequired()) return response;

  // Skip auth check for public paths and API routes
  const { pathname } = request.nextUrl;
  if (pathname.startsWith('/api/')) return response;
  if (isPublicPath(pathname)) return response;

  // This is only a fast redirect guard. API routes always validate the opaque
  // token hash, expiry, token version and user status against the database.
  const token = request.cookies.get('jade_session')?.value;

  if (!token) {
    // Determine locale from the path or default
    const localeMatch = pathname.match(/^\/(zh|en)/);
    const locale = localeMatch ? localeMatch[1] : 'zh';
    const loginUrl = new URL(`/${locale}/login`, request.url);
    loginUrl.searchParams.set('callbackUrl', request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ['/', '/(zh|en)/:path*', '/share/:path*'],
};
