import { describe, expect, it } from 'vitest';
import {
  BlockedDestinationError,
  assertUrlAllowed,
  classifyIpAddress,
  createGuardedLookup,
  resolveDestination,
  sanitizeDiagnostic,
  type DestinationPolicy,
} from '../../src/monitoring/ssrf.js';

const blocking: DestinationPolicy = { blockPrivateNetworks: true, requireHttps: false };
const permissive: DestinationPolicy = { blockPrivateNetworks: false, requireHttps: false };
const httpsOnly: DestinationPolicy = { blockPrivateNetworks: true, requireHttps: true };

describe('classifyIpAddress', () => {
  it.each(['93.184.216.34', '8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])(
    'allows the globally routable address %s',
    (address) => {
      expect(classifyIpAddress(address).allowed).toBe(true);
    },
  );

  it.each([
    ['127.0.0.1', 'loopback'],
    ['::1', 'loopback'],
    ['10.0.0.5', 'private'],
    ['172.16.4.4', 'private'],
    ['192.168.1.1', 'private'],
    ['169.254.169.254', 'linkLocal'], // cloud metadata endpoint
    ['fe80::1', 'linkLocal'],
    ['100.64.0.1', 'carrierGradeNat'],
    ['0.0.0.0', 'unspecified'],
    ['224.0.0.1', 'multicast'],
    ['fd00::1', 'uniqueLocal'],
    ['::ffff:127.0.0.1', 'loopback'], // IPv4-mapped IPv6 must not slip through
    ['::ffff:10.0.0.1', 'private'],
  ])('refuses %s (%s)', (address) => {
    const result = classifyIpAddress(address);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('refuses a value that is not an IP address at all', () => {
    expect(classifyIpAddress('example.com').allowed).toBe(false);
    expect(classifyIpAddress('').allowed).toBe(false);
    expect(classifyIpAddress('999.1.1.1').allowed).toBe(false);
  });
});

describe('assertUrlAllowed', () => {
  it('accepts a normal https URL', () => {
    expect(assertUrlAllowed('https://example.com/health', blocking).hostname).toBe('example.com');
  });

  it.each([
    ['ftp://example.com', /protocol "ftp:" is not allowed/],
    ['not-a-url', /not absolute/],
    ['https://user:secret@example.com/', /embedded credentials/],
    ['https://example.com:22/', /port 22 is not allowed/],
    ['https://example.com:25/', /port 25 is not allowed/],
    ['https://example.com:1023/', /port 1023 is not allowed/],
  ])('refuses %s even before any DNS lookup', (url, message) => {
    expect(() => assertUrlAllowed(url, blocking)).toThrow(BlockedDestinationError);
    expect(() => assertUrlAllowed(url, blocking)).toThrow(message);
  });

  it('allows the low ports 80 and 443', () => {
    expect(assertUrlAllowed('http://example.com/', blocking).toString()).toBe(
      'http://example.com/',
    );
    expect(assertUrlAllowed('https://example.com/', blocking).protocol).toBe('https:');
  });

  it('honours REQUIRE_HTTPS_TARGETS', () => {
    expect(() => assertUrlAllowed('http://example.com/', httpsOnly)).toThrow(/only https targets/);
    expect(assertUrlAllowed('https://example.com/', httpsOnly).protocol).toBe('https:');
  });
});

describe('resolveDestination', () => {
  it('passes a literal public address through unchanged', async () => {
    const result = await resolveDestination('93.184.216.34', blocking);
    expect(result.addresses).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('refuses a literal loopback or metadata address', async () => {
    await expect(resolveDestination('127.0.0.1', blocking)).rejects.toThrow(
      BlockedDestinationError,
    );
    await expect(resolveDestination('169.254.169.254', blocking)).rejects.toThrow(
      /linkLocal|disallowed|not allowed/,
    );
  });

  it('allows those same addresses only when the policy is relaxed (tests only)', async () => {
    await expect(resolveDestination('127.0.0.1', permissive)).resolves.toMatchObject({
      hostname: '127.0.0.1',
    });
  });

  it('raises a DNS-shaped error for a hostname that cannot resolve', async () => {
    await expect(resolveDestination('does-not-exist.invalid', permissive)).rejects.toMatchObject({
      name: 'DnsResolutionError',
    });
  });
});

describe('createGuardedLookup', () => {
  async function lookup(hostname: string, policy: DestinationPolicy): Promise<string> {
    const fn = createGuardedLookup(policy);
    return new Promise<string>((resolve, reject) => {
      (
        fn as unknown as (
          host: string,
          options: { all: false },
          callback: (error: Error | null, address: string, family: number) => void,
        ) => void
      )(hostname, { all: false }, (error, address) => {
        if (error) reject(error);
        else resolve(address);
      });
    });
  }

  it('rejects a hostname that only resolves to loopback when blocking is on', async () => {
    await expect(lookup('localhost', blocking)).rejects.toThrow(BlockedDestinationError);
  });

  it('resolves the same hostname when blocking is off', async () => {
    // `localhost` may be answered with ::1 or 127.0.0.1 depending on the host;
    // either is a genuine loopback answer, which is the point of the relaxation.
    await expect(lookup('localhost', permissive)).resolves.toBeOneOf(['127.0.0.1', '::1']);
  });
});

describe('sanitizeDiagnostic', () => {
  it('collapses newlines and tabs so one line is stored', () => {
    expect(sanitizeDiagnostic('line one\nline two\tend')).toBe('line one line two end');
  });

  it('redacts credentials embedded in a URL', () => {
    expect(sanitizeDiagnostic('failed to connect to https://user:pw@example.com/x')).toBe(
      'failed to connect to https://[redacted]@example.com/x',
    );
  });

  it('bounds the stored length', () => {
    const long = 'x'.repeat(2_000);
    const result = sanitizeDiagnostic(long, 100);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result.endsWith('…')).toBe(true);
  });

  it('is a no-op for a short message with no secrets', () => {
    expect(sanitizeDiagnostic('connection refused')).toBe('connection refused');
  });
});
