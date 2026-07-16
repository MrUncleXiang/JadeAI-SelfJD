import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const DNS_TIMEOUT_MS = 3_000;

export type AddressFamily = 4 | 6;
export type LookupAddress = { address: string; family: AddressFamily };
type Lookup = (hostname: string) => Promise<LookupAddress[]>;

export type ValidatedLlmTarget = {
  url: string;
  hostname: string;
  addresses: LookupAddress[];
};

export class LlmBaseUrlPolicyError extends Error {
  constructor(public readonly code:
    | 'INVALID_BASE_URL'
    | 'BASE_URL_BLOCKED'
    | 'BASE_URL_DNS_FAILED'
    | 'INVALID_BASE_URL_ALLOWLIST'
  ) {
    super(code);
    this.name = 'LlmBaseUrlPolicyError';
  }
}

const deniedAddresses = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  deniedAddresses.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::', 96],
  ['::1', 128],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  deniedAddresses.addSubnet(network, prefix, 'ipv6');
}

function addressType(address: string): 'ipv4' | 'ipv6' {
  const family = isIP(address);
  if (family === 4) return 'ipv4';
  if (family === 6) return 'ipv6';
  throw new LlmBaseUrlPolicyError('BASE_URL_DNS_FAILED');
}

function parseAllowlist(serialized = process.env.LLM_BASE_URL_ALLOWLIST || '') {
  const origins = new Set<string>();
  const cidrs = new BlockList();

  for (const rawEntry of serialized.split(',')) {
    const entry = rawEntry.trim();
    if (!entry) continue;

    const cidrMatch = /^(.*)\/(\d{1,3})$/.exec(entry);
    if (cidrMatch && isIP(cidrMatch[1])) {
      const type = addressType(cidrMatch[1]);
      const prefix = Number(cidrMatch[2]);
      const maxPrefix = type === 'ipv4' ? 32 : 128;
      if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
        throw new LlmBaseUrlPolicyError('INVALID_BASE_URL_ALLOWLIST');
      }
      try {
        cidrs.addSubnet(cidrMatch[1], prefix, type);
      } catch {
        throw new LlmBaseUrlPolicyError('INVALID_BASE_URL_ALLOWLIST');
      }
      continue;
    }

    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new LlmBaseUrlPolicyError('INVALID_BASE_URL_ALLOWLIST');
    }
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:')
      || url.username
      || url.password
      || url.pathname !== '/'
      || url.search
      || url.hash
    ) {
      throw new LlmBaseUrlPolicyError('INVALID_BASE_URL_ALLOWLIST');
    }
    origins.add(url.origin.toLowerCase());
  }

  return { origins, cidrs };
}

async function defaultLookup(hostname: string): Promise<LookupAddress[]> {
  return dnsLookup(hostname, { all: true, verbatim: true }) as Promise<LookupAddress[]>;
}

async function lookupWithTimeout(hostname: string, lookup: Lookup): Promise<LookupAddress[]> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = await Promise.race([
      lookup(hostname),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new LlmBaseUrlPolicyError('BASE_URL_DNS_FAILED')),
          DNS_TIMEOUT_MS,
        );
      }),
    ]);
    if (addresses.length === 0) throw new LlmBaseUrlPolicyError('BASE_URL_DNS_FAILED');
    return addresses;
  } catch (error) {
    if (error instanceof LlmBaseUrlPolicyError) throw error;
    throw new LlmBaseUrlPolicyError('BASE_URL_DNS_FAILED');
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function normalizedHostname(url: URL): string {
  const hostname = url.hostname.toLowerCase();
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

function isIpv4MappedIpv6(address: string): boolean {
  if (isIP(address) !== 6) return false;
  try {
    const hostname = new URL(`http://[${address}]/`).hostname.toLowerCase();
    return hostname.startsWith('[::ffff:');
  } catch {
    return true;
  }
}

export async function resolveLlmBaseUrlTarget(
  rawUrl: string,
  options: { lookup?: Lookup; allowlist?: string } = {},
): Promise<ValidatedLlmTarget> {
  if (!rawUrl || rawUrl.length > 2_048) {
    throw new LlmBaseUrlPolicyError('INVALID_BASE_URL');
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new LlmBaseUrlPolicyError('INVALID_BASE_URL');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new LlmBaseUrlPolicyError('INVALID_BASE_URL');
  }

  const hostname = normalizedHostname(url);
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    const allowlist = parseAllowlist(options.allowlist);
    if (!allowlist.origins.has(url.origin.toLowerCase())) {
      throw new LlmBaseUrlPolicyError('BASE_URL_BLOCKED');
    }
    return {
      url: url.toString(),
      hostname,
      addresses: hostname === 'localhost' || hostname.endsWith('.localhost')
        ? await lookupWithTimeout(hostname, options.lookup || defaultLookup)
        : [],
    };
  }

  const allowlist = parseAllowlist(options.allowlist);
  const originAllowed = allowlist.origins.has(url.origin.toLowerCase());
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily as AddressFamily }]
    : await lookupWithTimeout(hostname, options.lookup || defaultLookup);

  const allCidrAllowed = addresses.every(({ address }) => {
    const type = addressType(address);
    return allowlist.cidrs.check(address, type);
  });
  const hasDeniedAddress = addresses.some(({ address }) => {
    if (isIpv4MappedIpv6(address)) return true;
    const type = addressType(address);
    return deniedAddresses.check(address, type);
  });

  if (url.protocol !== 'https:' && !originAllowed && !allCidrAllowed) {
    throw new LlmBaseUrlPolicyError('BASE_URL_BLOCKED');
  }
  if (hasDeniedAddress && !originAllowed && !allCidrAllowed) {
    throw new LlmBaseUrlPolicyError('BASE_URL_BLOCKED');
  }

  return { url: url.toString(), hostname, addresses };
}

export async function validateLlmBaseUrl(
  rawUrl: string,
  options: { lookup?: Lookup; allowlist?: string } = {},
): Promise<string> {
  return (await resolveLlmBaseUrlTarget(rawUrl, options)).url;
}

function pathIsWithinBase(requestPath: string, basePath: string): boolean {
  if (basePath === '/') return true;
  const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
  return requestPath === basePath || requestPath.startsWith(normalizedBase);
}

/**
 * Revalidates a concrete provider request immediately before the transport opens
 * a socket. Query parameters are allowed here because provider SDKs add them,
 * while credentials, fragments, cross-origin targets and paths outside the
 * configured BaseURL remain forbidden.
 */
export async function validateLlmRequestUrl(
  rawUrl: string,
  configuredBaseUrl: string,
  options: { lookup?: Lookup; allowlist?: string } = {},
): Promise<ValidatedLlmTarget> {
  let requestUrl: URL;
  let baseUrl: URL;
  try {
    requestUrl = new URL(rawUrl);
    baseUrl = new URL(configuredBaseUrl);
  } catch {
    throw new LlmBaseUrlPolicyError('INVALID_BASE_URL');
  }

  if (
    requestUrl.username
    || requestUrl.password
    || requestUrl.hash
    || requestUrl.origin.toLowerCase() !== baseUrl.origin.toLowerCase()
    || !pathIsWithinBase(requestUrl.pathname, baseUrl.pathname)
  ) {
    throw new LlmBaseUrlPolicyError('BASE_URL_BLOCKED');
  }

  const target = await resolveLlmBaseUrlTarget(configuredBaseUrl, options);
  return { ...target, url: requestUrl.toString() };
}
