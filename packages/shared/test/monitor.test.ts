import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../src/limits.js';
import {
  createHeadersSchema,
  createLoginSchema,
  createMonitorCreateSchema,
  createMonitorUpdateSchema,
  createRegisterSchema,
  createUrlSchema,
  validateMergedMonitorConfig,
} from '../src/monitor.js';

const validMonitor = {
  name: 'Public API',
  url: 'https://example.com/health',
};

describe('createUrlSchema', () => {
  it('accepts http and https URLs', () => {
    expect(createUrlSchema().safeParse('https://example.com/health').success).toBe(true);
    expect(createUrlSchema().safeParse('http://example.com:8080/x?y=1').success).toBe(true);
  });

  it.each([
    ['not a url', 'Enter a valid absolute URL'],
    ['ftp://example.com', 'Only http and https URLs can be monitored'],
  ])('rejects %s', (value, message) => {
    const result = createUrlSchema().safeParse(value);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe(message);
  });

  it('rejects embedded credentials', () => {
    const result = createUrlSchema().safeParse('https://user:pass@example.com/');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        'URLs with embedded credentials are not allowed',
      );
    }
  });

  it('rejects a URL longer than the configured maximum', () => {
    const long = `https://example.com/${'a'.repeat(DEFAULT_LIMITS.maxUrlLength)}`;
    expect(createUrlSchema().safeParse(long).success).toBe(false);
  });
});

describe('createHeadersSchema', () => {
  it('trims names and values', () => {
    const result = createHeadersSchema().safeParse({ '  X-Api-Key  ': '  secret  ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ 'X-Api-Key': 'secret' });
  });

  it.each(['host', 'Content-Length', 'COOKIE', 'connection'])(
    'rejects the engine-managed header %s',
    (name) => {
      const result = createHeadersSchema().safeParse({ [name]: 'x' });
      expect(result.success).toBe(false);
    },
  );

  it('rejects a header value containing CRLF (header injection)', () => {
    const result = createHeadersSchema().safeParse({ 'X-Test': 'a\r\nX-Injected: 1' });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid header name', () => {
    expect(createHeadersSchema().safeParse({ 'bad name': 'x' }).success).toBe(false);
  });

  it('rejects more headers than the limit allows', () => {
    const headers: Record<string, string> = {};
    for (let index = 0; index <= DEFAULT_LIMITS.maxHeaders; index += 1) {
      headers[`X-Header-${index}`] = 'v';
    }
    expect(createHeadersSchema().safeParse(headers).success).toBe(false);
  });
});

describe('createMonitorCreateSchema', () => {
  const schema = createMonitorCreateSchema();

  it('accepts a minimal monitor and applies the documented defaults', () => {
    const result = schema.safeParse(validMonitor);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      name: 'Public API',
      url: 'https://example.com/health',
      method: 'GET',
      intervalSeconds: DEFAULT_LIMITS.defaultIntervalSeconds,
      timeoutMs: DEFAULT_LIMITS.defaultTimeoutMs,
      expectedStatusMin: 200,
      expectedStatusMax: 299,
      headers: {},
      body: null,
      degradedResponseTimeMs: null,
      enabled: true,
    });
  });

  it('rejects unknown keys (strict schema)', () => {
    expect(schema.safeParse({ ...validMonitor, userId: 'x' }).success).toBe(false);
  });

  it('enforces the minimum interval', () => {
    const result = schema.safeParse({ ...validMonitor, intervalSeconds: 5 });
    expect(result.success).toBe(false);
  });

  it('enforces the timeout range', () => {
    expect(schema.safeParse({ ...validMonitor, timeoutMs: 10 }).success).toBe(false);
    expect(
      schema.safeParse({ ...validMonitor, timeoutMs: DEFAULT_LIMITS.maxTimeoutMs + 1 }).success,
    ).toBe(false);
  });

  it('rejects an inverted expected-status range', () => {
    const result = schema.safeParse({
      ...validMonitor,
      expectedStatusMin: 500,
      expectedStatusMax: 200,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a body on a GET monitor', () => {
    const result = schema.safeParse({ ...validMonitor, method: 'GET', body: '{"a":1}' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain('body');
    }
  });

  it('allows a body on a POST monitor', () => {
    expect(schema.safeParse({ ...validMonitor, method: 'POST', body: '{"a":1}' }).success).toBe(
      true,
    );
  });

  it('rejects a degraded threshold above the timeout', () => {
    const result = schema.safeParse({
      ...validMonitor,
      timeoutMs: 2_000,
      degradedResponseTimeMs: 5_000,
    });
    expect(result.success).toBe(false);
  });

  it('normalises an empty body string to null', () => {
    const result = schema.safeParse({ ...validMonitor, method: 'POST', body: '' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.body).toBeNull();
  });
});

describe('createMonitorUpdateSchema', () => {
  const schema = createMonitorUpdateSchema();

  it('rejects an empty patch', () => {
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('accepts a single field', () => {
    expect(schema.safeParse({ name: 'Renamed' }).success).toBe(true);
  });

  it('keeps "not provided" distinct from "set to null" for the body', () => {
    // `undefined` means "leave the stored body alone"; `null` means "clear it".
    expect(schema.safeParse({ name: 'x' }).success).toBe(true);
    const cleared = schema.safeParse({ body: null });
    expect(cleared.success).toBe(true);
    if (cleared.success) expect(cleared.data.body).toBeNull();
  });
});

describe('validateMergedMonitorConfig', () => {
  const base = {
    name: 'm',
    url: 'https://example.com',
    method: 'GET' as const,
    intervalSeconds: DEFAULT_LIMITS.defaultIntervalSeconds,
    timeoutMs: DEFAULT_LIMITS.defaultTimeoutMs,
    expectedStatusMin: 200,
    expectedStatusMax: 299,
    headers: {},
    body: null,
    degradedResponseTimeMs: null,
  };

  it('accepts a valid merged configuration', () => {
    expect(validateMergedMonitorConfig(base)).toEqual([]);
  });

  it('rejects a merged configuration that a patch made invalid', () => {
    expect(
      validateMergedMonitorConfig({ ...base, expectedStatusMin: 500, expectedStatusMax: 400 }),
    ).toHaveLength(1);
    expect(validateMergedMonitorConfig({ ...base, method: 'GET', body: 'x' })).toHaveLength(1);
    expect(
      validateMergedMonitorConfig({ ...base, degradedResponseTimeMs: 60_000, timeoutMs: 5_000 }),
    ).toHaveLength(1);
    expect(validateMergedMonitorConfig({ ...base, intervalSeconds: 1 })).toHaveLength(1);
  });
});

describe('auth schemas', () => {
  it('normalises the email to lower case and trims it', () => {
    const result = createRegisterSchema().safeParse({
      email: '  USER@Example.COM ',
      password: 'correct horse battery',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe('user@example.com');
  });

  it('enforces the minimum password length on register', () => {
    expect(createRegisterSchema().safeParse({ email: 'a@b.com', password: 'short' }).success).toBe(
      false,
    );
  });

  it('only checks shape on login so errors do not leak policy', () => {
    const result = createLoginSchema().safeParse({ email: 'a@b.com', password: 'x' });
    expect(result.success).toBe(true);
  });

  it('rejects unknown keys on both auth schemas', () => {
    expect(
      createRegisterSchema().safeParse({
        email: 'a@b.com',
        password: 'correct horse battery',
        admin: true,
      }).success,
    ).toBe(false);
    expect(
      createLoginSchema().safeParse({ email: 'a@b.com', password: 'x', role: 'root' }).success,
    ).toBe(false);
  });
});
