import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import dnsCallback from 'node:dns';
import ipaddr from 'ipaddr.js';
import type { LookupFunction } from 'node:net';

/**
 * SSRF defence for outbound monitoring requests.
 *
 * Layered so that no single mistake opens a hole:
 *
 *  1. `assertUrlAllowed` - protocol, credentials and port policy (a URL validator
 *     alone is never sufficient; this is only the cheap first gate).
 *  2. `resolveDestination` - resolve the hostname and reject the request if ANY
 *     resolved address is not globally routable. This covers IPv4, IPv6 and
 *     IPv4-mapped IPv6 addresses.
 *  3. `guardedLookup` - the same check runs again inside the DNS lookup used by
 *     the HTTP client, so the address that is actually connected to is validated
 *     at connect time. This closes the DNS-rebinding window between step 2 and
 *     the socket being opened.
 *  4. Redirects - `performCheck` never follows a redirect automatically; each
 *     hop repeats steps 1-3 before a new connection is made.
 *
 * `BLOCK_PRIVATE_NETWORKS=false` disables the address checks and exists only for
 * tests that monitor a loopback mock server. It must never be used in production.
 */

export class BlockedDestinationError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`Destination blocked: ${reason}`);
    this.name = 'BlockedDestinationError';
    this.reason = reason;
  }
}

export interface DestinationPolicy {
  /** Reject non-globally-routable addresses. */
  blockPrivateNetworks: boolean;
  /** Reject http:// targets. */
  requireHttps: boolean;
}

/** Ports below 1024 that are still allowed. Everything else under 1024 is refused. */
const ALLOWED_LOW_PORTS = new Set([80, 443]);

export interface IpClassification {
  allowed: boolean;
  reason?: string;
}

/**
 * Classify a single IP address.
 *
 * Only ipaddr.js's `unicast` range is accepted. Everything else - loopback,
 * private, link-local (which covers cloud metadata at 169.254.169.254), unique
 * local, carrier-grade NAT, multicast, reserved, unspecified, broadcast, 6to4,
 * Teredo and NAT64 prefixes - is refused.
 */
export function classifyIpAddress(address: string): IpClassification {
  if (isIP(address) === 0 || !ipaddr.isValid(address)) {
    return { allowed: false, reason: `not a valid IP address (${address.slice(0, 45)})` };
  }

  let parsed: ipaddr.IPv4 | ipaddr.IPv6 = ipaddr.parse(address);

  if (parsed.kind() === 'ipv6') {
    const v6 = parsed as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) {
      // ::ffff:127.0.0.1 must be judged as 127.0.0.1, not as a harmless IPv6.
      parsed = v6.toIPv4Address();
    }
  }

  const range = parsed.range();
  if (range === 'unicast') return { allowed: true };
  return { allowed: false, reason: `address is in the "${range}" range` };
}

/** Validate scheme, embedded credentials and port. */
export function assertUrlAllowed(rawUrl: string, policy: DestinationPolicy): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedDestinationError('URL is not absolute');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedDestinationError(`protocol "${url.protocol}" is not allowed`);
  }
  if (policy.requireHttps && url.protocol !== 'https:') {
    throw new BlockedDestinationError('only https targets are allowed (REQUIRE_HTTPS_TARGETS)');
  }
  if (url.username || url.password) {
    throw new BlockedDestinationError('URLs with embedded credentials are not allowed');
  }
  if (!url.hostname) {
    throw new BlockedDestinationError('URL must include a hostname');
  }

  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new BlockedDestinationError('port is out of range');
  }
  if (port < 1024 && !ALLOWED_LOW_PORTS.has(port)) {
    throw new BlockedDestinationError(`port ${port} is not allowed for outbound checks`);
  }

  return url;
}

export interface ResolvedDestination {
  hostname: string;
  addresses: Array<{ address: string; family: number }>;
}

/**
 * Resolve a hostname and require every answer to be globally routable.
 *
 * Rejecting the whole request when any answer is private is deliberate: a
 * hostname that returns both a public and a private address is a classic
 * rebinding/poisoning setup and must not be used at all.
 */
export async function resolveDestination(
  hostname: string,
  policy: DestinationPolicy,
): Promise<ResolvedDestination> {
  if (isIP(hostname) !== 0) {
    const classification = policy.blockPrivateNetworks
      ? classifyIpAddress(hostname)
      : { allowed: true };
    if (!classification.allowed) {
      throw new BlockedDestinationError(classification.reason ?? 'address is not allowed');
    }
    return { hostname, addresses: [{ address: hostname, family: isIP(hostname) }] };
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'EDNS';
    const reason = `${hostname} could not be resolved (${code})`;
    const dnsError = new Error(reason) as NodeJS.ErrnoException;
    dnsError.code = code;
    dnsError.name = 'DnsResolutionError';
    throw dnsError;
  }

  if (addresses.length === 0) {
    const error = new Error(`${hostname} resolved to no addresses`) as NodeJS.ErrnoException;
    error.code = 'ENOTFOUND';
    error.name = 'DnsResolutionError';
    throw error;
  }

  if (policy.blockPrivateNetworks) {
    for (const entry of addresses) {
      const classification = classifyIpAddress(entry.address);
      if (!classification.allowed) {
        throw new BlockedDestinationError(
          `${hostname} resolves to a disallowed address (${classification.reason})`,
        );
      }
    }
  }

  return { hostname, addresses };
}

/**
 * A `lookup` implementation for the HTTP client's `connect` options.
 *
 * The HTTP client calls this every time it opens a socket, so the address used
 * for the connection is validated at that moment - not minutes earlier when the
 * monitor was saved.
 */
export function createGuardedLookup(policy: DestinationPolicy): LookupFunction {
  return ((hostname, options, callback) => {
    const wantsAll = typeof options === 'object' && options !== null && options.all === true;

    // The callback-style resolver from `node:dns` is required here: the HTTP
    // client expects the Node callback signature, not a promise.
    dnsCallback.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) {
        callback(error, '', 4);
        return;
      }

      const entries = Array.isArray(addresses)
        ? addresses
        : [{ address: addresses as unknown as string, family: 4 }];

      const usable = policy.blockPrivateNetworks
        ? entries.filter((entry) => classifyIpAddress(entry.address).allowed)
        : entries;

      if (usable.length === 0) {
        callback(
          new BlockedDestinationError(`${hostname} has no allowed address`) as unknown as Error,
          '',
          4,
        );
        return;
      }

      const family = typeof options === 'object' && options?.family ? options.family : 0;
      const preferred = family
        ? (usable.find((entry) => entry.family === family) ?? usable[0])
        : usable[0];

      if (!preferred) {
        callback(new Error(`${hostname} has no usable address`) as unknown as Error, '', 4);
        return;
      }

      if (wantsAll) {
        (callback as unknown as (e: Error | null, a: typeof usable) => void)(null, usable);
        return;
      }

      (callback as unknown as (e: Error | null, a: string, f: number) => void)(
        null,
        preferred.address,
        preferred.family,
      );
    });
  }) as LookupFunction;
}

/**
 * Strip anything unsafe from a diagnostic message before it is persisted or
 * returned. Never includes headers, bodies or credentials.
 */
export function sanitizeDiagnostic(message: string, maxLength = 500): string {
  const singleLine = message.replace(/[\r\n\t]+/g, ' ').trim();
  const withoutCredentials = singleLine.replace(/:\/\/[^@/\s]+@/g, '://[redacted]@');
  return withoutCredentials.length > maxLength
    ? `${withoutCredentials.slice(0, maxLength - 1)}…`
    : withoutCredentials;
}
