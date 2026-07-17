import { isIP } from 'node:net';
import type { NextRequest, NextResponse } from 'next/server';

export const SESSION_COOKIE_NAME = 'jade_session';
const DEFAULT_SESSION_TTL_DAYS = 30;

export function sessionCookieSecure(
  nodeEnv = process.env.NODE_ENV,
  override = process.env.AUTH_COOKIE_SECURE,
): boolean {
  if (override === 'true') return true;
  if (override === 'false') return false;
  return nodeEnv === 'production';
}

function sessionTtlSeconds(): number {
  const configured = Number(process.env.SESSION_TTL_DAYS || DEFAULT_SESSION_TTL_DAYS);
  const days = Number.isFinite(configured) ? Math.min(Math.max(configured, 1), 90) : DEFAULT_SESSION_TTL_DAYS;
  return days * 24 * 60 * 60;
}

export function sessionExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + sessionTtlSeconds() * 1000);
}

export function readSessionToken(request: Request): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (name !== SESSION_COOKIE_NAME) continue;
    const value = part.slice(separator + 1).trim();
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

export function setSessionCookie(response: NextResponse, token: string, expiresAt: Date): void {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: sessionCookieSecure(),
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: sessionCookieSecure(),
    path: '/',
    expires: new Date(0),
  });
}

export function hasTrustedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return process.env.NODE_ENV !== 'production';
  try {
    const suppliedOrigin = new URL(origin).origin;
    if (suppliedOrigin === request.nextUrl.origin) return true;

    // A standalone Next.js server can expose request.nextUrl as localhost even
    // when the browser reached an explicitly configured public origin.
    const configuredOrigin = process.env.AUTH_URL
      ? new URL(process.env.AUTH_URL).origin
      : null;
    return suppliedOrigin === configuredOrigin;
  } catch {
    return false;
  }
}

export function getRequestMetadata(request: Request): {
  requestId: string;
  userAgent: string | null;
  ipPrefix: string | null;
} {
  const trustProxyHeaders = process.env.TRUST_PROXY_HEADERS === 'true';
  const forwardedFor = trustProxyHeaders
    ? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    : null;
  const realIp = trustProxyHeaders ? request.headers.get('x-real-ip')?.trim() : null;
  const suppliedRequestId = request.headers.get('x-request-id');
  return {
    requestId: suppliedRequestId && /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedRequestId)
      ? suppliedRequestId
      : crypto.randomUUID(),
    userAgent: request.headers.get('user-agent'),
    ipPrefix: toIpPrefix(forwardedFor || realIp || null),
  };
}

function toIpPrefix(ip: string | null): string | null {
  if (!ip) return null;
  const address = ip.split('%', 1)[0];
  if (isIP(address) === 4) {
    const octets = address.split('.');
    return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
  }
  if (isIP(address) === 6) {
    const [left = '', right = ''] = address.toLowerCase().split('::');
    const leftParts = left ? left.split(':') : [];
    const rightParts = right ? right.split(':') : [];
    const parts = address.includes('::')
      ? [...leftParts, ...Array(Math.max(0, 8 - leftParts.length - rightParts.length)).fill('0'), ...rightParts]
      : leftParts;
    return `${parts.slice(0, 4).map((part) => part || '0').join(':')}::/64`;
  }
  return null;
}
