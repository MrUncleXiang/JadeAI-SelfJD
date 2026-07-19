import type { LookupFunction } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

import {
  LlmBaseUrlPolicyError,
  type LookupAddress,
  validateLlmRequestUrl,
} from './outbound-url';

const DEFAULT_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 5 * 60_000;
const DISPATCHER_CLOSE_GRACE_MS = 5_000;

export class LlmOutboundRequestError extends Error {
  constructor(public readonly code:
    | 'OUTBOUND_URL_BLOCKED'
    | 'OUTBOUND_DNS_FAILED'
    | 'OUTBOUND_REDIRECT_BLOCKED'
    | 'OUTBOUND_TIMEOUT'
  ) {
    super(code);
    this.name = 'LlmOutboundRequestError';
  }
}

function configuredTimeout(override?: number): number {
  const value = Number.isFinite(override) ? Number(override) : Number(process.env.LLM_REQUEST_TIMEOUT_MS);
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(value)));
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function mapPolicyError(error: LlmBaseUrlPolicyError): LlmOutboundRequestError {
  return new LlmOutboundRequestError(
    error.code === 'BASE_URL_DNS_FAILED'
      ? 'OUTBOUND_DNS_FAILED'
      : 'OUTBOUND_URL_BLOCKED',
  );
}

function pinnedLookup(addresses: LookupAddress[]): LookupFunction {
  let cursor = 0;
  return (_hostname, options, callback) => {
    const requestedFamily = options.family === 4 || options.family === 6
      ? options.family
      : null;
    const eligible = requestedFamily
      ? addresses.filter((entry) => entry.family === requestedFamily)
      : addresses;

    if (eligible.length === 0) {
      const error = new Error('No validated address for requested family') as NodeJS.ErrnoException;
      error.code = 'ENOTFOUND';
      callback(error, '', 0);
      return;
    }

    if (options.all) {
      callback(null, eligible.map(({ address, family }) => ({ address, family })));
      return;
    }

    const selected = eligible[cursor % eligible.length];
    cursor += 1;
    callback(null, selected.address, selected.family);
  };
}

function scheduleDispatcherClose(dispatcher: Agent, timeoutMs: number) {
  const timer = setTimeout(() => {
    void dispatcher.close();
  }, timeoutMs + DISPATCHER_CLOSE_GRACE_MS);
  timer.unref?.();
}

function combinedSignal(signal: AbortSignal | null | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * Creates a provider fetch implementation that re-resolves and validates the
 * destination for every request, pins the validated IPs into the socket lookup,
 * and rejects all redirects rather than allowing a second unvalidated hop.
 */
export function createLlmProviderFetch(
  configuredBaseUrl: string,
  options: { timeoutMs?: number } = {},
): typeof globalThis.fetch {
  const timeoutMs = configuredTimeout(options.timeoutMs);
  return async (input, init) => {
    let target;
    try {
      target = await validateLlmRequestUrl(requestUrl(input), configuredBaseUrl);
    } catch (error) {
      if (error instanceof LlmBaseUrlPolicyError) throw mapPolicyError(error);
      throw error;
    }

    const dispatcher = new Agent({
      connect: { lookup: pinnedLookup(target.addresses) },
      connectTimeout: Math.min(timeoutMs, 10_000),
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      keepAliveTimeout: 1_000,
      keepAliveMaxTimeout: 1_000,
    });
    scheduleDispatcherClose(dispatcher, timeoutMs);

    try {
      const response = await undiciFetch(input as Parameters<typeof undiciFetch>[0], {
        ...(init as Parameters<typeof undiciFetch>[1]),
        dispatcher,
        redirect: 'manual',
        signal: combinedSignal(init?.signal, timeoutMs),
      });

      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new LlmOutboundRequestError('OUTBOUND_REDIRECT_BLOCKED');
      }
      return response as unknown as Response;
    } catch (error) {
      if (error instanceof LlmOutboundRequestError) throw error;
      if (
        (error instanceof DOMException && error.name === 'TimeoutError')
        || (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
      ) {
        throw new LlmOutboundRequestError('OUTBOUND_TIMEOUT');
      }
      throw error;
    }
  };
}
