import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db.js';
import { limits } from '../../src/env.js';
import type { MonitorDto } from '@pulsecheck/shared';
import {
  cleanupUser,
  createTestContext,
  seedCheckResults,
  seedMonitor,
  signUp,
  uniqueEmail,
} from '../helpers/factories.js';
import type { TestClient } from '../helpers/client.js';

const createdUserIds: string[] = [];

afterEach(async () => {
  for (const userId of createdUserIds.splice(0)) await cleanupUser(userId);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function signedIn(): Promise<{ client: TestClient; userId: string }> {
  const { client } = createTestContext();
  const user = await signUp(client);
  createdUserIds.push(user.id);
  return { client, userId: user.id };
}

const validMonitor = {
  name: 'Public API',
  url: 'https://example.com/health',
  intervalSeconds: 60,
  timeoutMs: 5_000,
};

async function createMonitor(
  client: TestClient,
  overrides: Record<string, unknown> = {},
): Promise<MonitorDto> {
  const response = await client.post('/api/v1/monitors', { ...validMonitor, ...overrides });
  if (response.status !== 201) {
    throw new Error(`create failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body.monitor as MonitorDto;
}

describe('POST /api/v1/monitors', () => {
  it('creates a monitor with the documented defaults and a PENDING status', async () => {
    const { client } = await signedIn();
    const monitor = await createMonitor(client, { name: 'Status page' });

    expect(monitor).toMatchObject({
      name: 'Status page',
      url: validMonitor.url,
      method: 'GET',
      intervalSeconds: 60,
      timeoutMs: 5_000,
      expectedStatusMin: 200,
      expectedStatusMax: 299,
      headers: {},
      body: null,
      degradedResponseTimeMs: null,
      enabled: true,
      status: 'PENDING',
      lastCheckedAt: null,
      consecutiveFailures: 0,
    });
    expect(monitor.nextCheckAt).toBeTruthy();
    expect(new Date(monitor.nextCheckAt).getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  it('creates a PAUSED monitor when enabled is false', async () => {
    const { client } = await signedIn();
    const monitor = await createMonitor(client, { enabled: false });
    expect(monitor.enabled).toBe(false);
    expect(monitor.status).toBe('PAUSED');
  });

  it('normalises header names and values', async () => {
    const { client } = await signedIn();
    const monitor = await createMonitor(client, {
      headers: { '  X-Api-Key  ': '  abc123  ' },
    });
    expect(monitor.headers).toEqual({ 'X-Api-Key': 'abc123' });
  });

  it.each([
    ['an invalid url', { url: 'not-a-url' }, 'url'],
    ['an unsupported scheme', { url: 'ftp://example.com' }, 'url'],
    ['a url with credentials', { url: 'https://u:p@example.com/' }, 'url'],
    ['an unknown field', { nonsense: true }, ''],
    ['too short an interval', { intervalSeconds: 1 }, 'intervalSeconds'],
    [
      'an inverted status range',
      { expectedStatusMin: 500, expectedStatusMax: 200 },
      'expectedStatusMax',
    ],
    ['a body on a GET monitor', { method: 'GET', body: 'x' }, 'body'],
    ['a managed header', { headers: { host: 'evil.example.com' } }, 'headers'],
    ['a header with CRLF', { headers: { 'X-Test': 'a\r\nX-Injected: 1' } }, 'headers'],
  ])('rejects %s with VALIDATION_ERROR', async (_label, overrides, expectedPath) => {
    const { client } = await signedIn();
    const response = await client.post('/api/v1/monitors', { ...validMonitor, ...overrides });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    if (expectedPath) {
      const paths = (response.body.error.details.issues as Array<{ path: string }>).map(
        (issue) => issue.path,
      );
      expect(paths).toContain(expectedPath);
    }
  });

  it('requires authentication', async () => {
    const response = await createTestContext().client.post('/api/v1/monitors', validMonitor);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('enforces the per-account monitor limit', async () => {
    const { client } = await signedIn();
    const original = limits.maxMonitorsPerUser;
    limits.maxMonitorsPerUser = 2;

    try {
      await createMonitor(client, { name: 'one' });
      await createMonitor(client, { name: 'two' });
      const third = await client.post('/api/v1/monitors', { ...validMonitor, name: 'three' });

      expect(third.status).toBe(409);
      expect(third.body.error.code).toBe('LIMIT_EXCEEDED');
      expect(third.body.error.message).toMatch(/at most 2 monitors/);
    } finally {
      limits.maxMonitorsPerUser = original;
    }
  });
});

describe('GET /api/v1/monitors', () => {
  it('lists only the caller’s monitors, newest first by default', async () => {
    const owner = await signedIn();
    const stranger = await signedIn();

    await createMonitor(owner.client, { name: 'Alpha' });
    await createMonitor(owner.client, { name: 'Beta' });
    await createMonitor(stranger.client, { name: 'Not mine' });

    const response = await owner.client.get('/api/v1/monitors');
    expect(response.status).toBe(200);
    const names = (response.body.items as MonitorDto[]).map((monitor) => monitor.name);
    expect(names).toContain('Alpha');
    expect(names).toContain('Beta');
    expect(names).not.toContain('Not mine');

    const strangerList = await stranger.client.get('/api/v1/monitors');
    expect((strangerList.body.items as MonitorDto[]).map((monitor) => monitor.name)).toEqual([
      'Not mine',
    ]);
  });

  it('supports search, status filter, sorting and order', async () => {
    const { client } = await signedIn();
    await createMonitor(client, { name: 'Zeta payments' });
    await createMonitor(client, { name: 'Alpha search' });
    const paused = await createMonitor(client, { name: 'Paused one', enabled: false });

    const searched = await client.get('/api/v1/monitors?search=payments');
    expect((searched.body.items as MonitorDto[]).map((monitor) => monitor.name)).toEqual([
      'Zeta payments',
    ]);

    // Search also covers the URL.
    const byUrl = await client.get('/api/v1/monitors?search=example.com');
    expect((byUrl.body.items as MonitorDto[]).length).toBe(3);

    const pausedOnly = await client.get('/api/v1/monitors?status=PAUSED');
    expect((pausedOnly.body.items as MonitorDto[]).map((monitor) => monitor.id)).toEqual([
      paused.id,
    ]);

    const all = await client.get('/api/v1/monitors?status=ALL');
    expect((all.body.items as MonitorDto[]).length).toBe(3);

    const ascending = await client.get('/api/v1/monitors?sort=name&order=asc');
    expect((ascending.body.items as MonitorDto[]).map((monitor) => monitor.name)).toEqual([
      'Alpha search',
      'Paused one',
      'Zeta payments',
    ]);

    const descending = await client.get('/api/v1/monitors?sort=name&order=desc');
    expect((descending.body.items as MonitorDto[])[0]?.name).toBe('Zeta payments');
  });

  it('rejects an unknown sort field', async () => {
    const { client } = await signedIn();
    const response = await client.get('/api/v1/monitors?sort=password');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('exposes the supported HTTP methods for the create form', async () => {
    const { client } = await signedIn();
    const response = await client.get('/api/v1/monitors/meta/methods');
    expect(response.status).toBe(200);
    expect(response.body.methods).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
  });
});

describe('GET /api/v1/monitors/:id', () => {
  it('returns the monitor', async () => {
    const { client } = await signedIn();
    const monitor = await createMonitor(client);

    const response = await client.get(`/api/v1/monitors/${monitor.id}`);
    expect(response.status).toBe(200);
    expect(response.body.monitor.id).toBe(monitor.id);
  });

  it('answers 404 - never 403 - for another account’s monitor', async () => {
    const owner = await signedIn();
    const stranger = await signedIn();
    const monitor = await createMonitor(owner.client);

    const response = await stranger.client.get(`/api/v1/monitors/${monitor.id}`);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects a non-UUID id without touching the database', async () => {
    const { client } = await signedIn();
    const response = await client.get('/api/v1/monitors/not-a-uuid');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('PATCH /api/v1/monitors/:id', () => {
  it('applies a partial update without disturbing other fields', async () => {
    const { client } = await signedIn();
    const monitor = await createMonitor(client, { name: 'Before' });

    const response = await client.patch(`/api/v1/monitors/${monitor.id}`, { name: 'After' });
    expect(response.status).toBe(200);
    expect(response.body.monitor.name).toBe('After');
    expect(response.body.monitor.url).toBe(monitor.url);
    expect(response.body.monitor.headers).toEqual({});
  });

  it('clears the request body when it is explicitly set to null', async () => {
    const { client } = await signedIn();
    const monitor = await createMonitor(client, { method: 'POST', body: '{"a":1}' });
    expect(monitor.body).toBe('{"a":1}');

    const cleared = await client.patch(`/api/v1/monitors/${monitor.id}`, { body: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.monitor.body).toBeNull();
  });

  it('leaves the body untouched when the field is omitted', async () => {
    const { client } = await signedIn();
    const monitor = await createMonitor(client, { method: 'POST', body: '{"a":1}' });

    const renamed = await client.patch(`/api/v1/monitors/${monitor.id}`, { name: 'Renamed' });
    expect(renamed.body.monitor.body).toBe('{"a":1}');
  });

  it('rejects an empty patch', async () => {
    const { client } = await signedIn();
    const monitor = await createMonitor(client);

    const response = await client.patch(`/api/v1/monitors/${monitor.id}`, {});
    expect(response.status).toBe(400);
  });

  it('rejects a patch that would make the merged configuration invalid', async () => {
    const { client } = await signedIn();
    const monitor = await createMonitor(client, { expectedStatusMin: 200, expectedStatusMax: 299 });

    const response = await client.patch(`/api/v1/monitors/${monitor.id}`, {
      expectedStatusMin: 500,
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
    expect(response.body.error.message).toMatch(/Maximum status code/);
  });

  it('pauses through the enabled flag and back again', async () => {
    const { client } = await signedIn();
    const monitor = await createMonitor(client);

    const paused = await client.patch(`/api/v1/monitors/${monitor.id}`, { enabled: false });
    expect(paused.body.monitor.status).toBe('PAUSED');

    const resumed = await client.patch(`/api/v1/monitors/${monitor.id}`, { enabled: true });
    expect(resumed.body.monitor.status).toBe('PENDING');
    expect(resumed.body.monitor.enabled).toBe(true);
  });

  it('checks a changed target immediately', async () => {
    const { client } = await signedIn();
    const monitor = await createMonitor(client);
    await prisma.monitor.update({
      where: { id: monitor.id },
      data: { nextCheckAt: new Date(Date.now() + 60_000) },
    });

    const changed = await client.patch(`/api/v1/monitors/${monitor.id}`, {
      url: 'https://example.org/health',
    });

    expect(new Date(changed.body.monitor.nextCheckAt).getTime()).toBeLessThanOrEqual(
      Date.now() + 5_000,
    );
  });
});

describe('POST /api/v1/monitors/:id/pause and /resume', () => {
  it('pausing resolves any open incident and stops scheduling', async () => {
    const { client } = await signedIn();
    const monitor = await createMonitor(client);

    await prisma.monitor.update({
      where: { id: monitor.id },
      data: { status: 'DOWN' },
    });
    await prisma.incident.create({
      data: {
        monitorId: monitor.id,
        startedAt: new Date(Date.now() - 60_000),
        initialStatus: 'DOWN',
        peakStatus: 'DOWN',
        failedCheckCount: 2,
      },
    });

    const response = await client.post(`/api/v1/monitors/${monitor.id}/pause`);
    expect(response.status).toBe(200);
    expect(response.body.monitor.status).toBe('PAUSED');
    expect(response.body.monitor.enabled).toBe(false);

    const incident = await prisma.incident.findFirstOrThrow({ where: { monitorId: monitor.id } });
    expect(incident.resolvedAt).not.toBeNull();
    expect(incident.latestErrorSummary).toMatch(/paused/i);
  });

  it('resuming returns the monitor to PENDING and schedules it now', async () => {
    const { client } = await signedIn();
    const monitor = await createMonitor(client, { enabled: false });

    const response = await client.post(`/api/v1/monitors/${monitor.id}/resume`);
    expect(response.status).toBe(200);
    expect(response.body.monitor.status).toBe('PENDING');
    expect(response.body.monitor.enabled).toBe(true);
    expect(new Date(response.body.monitor.nextCheckAt).getTime()).toBeLessThanOrEqual(
      Date.now() + 5_000,
    );
  });

  it('is idempotent for an already-paused or already-running monitor', async () => {
    const { client } = await signedIn();
    const running = await createMonitor(client);
    const paused = await createMonitor(client, { enabled: false });

    expect((await client.post(`/api/v1/monitors/${running.id}/resume`)).status).toBe(200);
    expect((await client.post(`/api/v1/monitors/${running.id}/resume`)).body.monitor.status).toBe(
      'PENDING',
    );
    expect((await client.post(`/api/v1/monitors/${paused.id}/pause`)).body.monitor.status).toBe(
      'PAUSED',
    );
  });

  it('cannot pause another account’s monitor', async () => {
    const owner = await signedIn();
    const stranger = await signedIn();
    const monitor = await createMonitor(owner.client);

    const response = await stranger.client.post(`/api/v1/monitors/${monitor.id}/pause`);
    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/v1/monitors/:id', () => {
  it('deletes the monitor and its history', async () => {
    const { client } = await signedIn();
    const monitor = await createMonitor(client);
    await seedCheckResults(monitor.id, [{ success: true, responseTimeMs: 10 }]);

    const response = await client.delete(`/api/v1/monitors/${monitor.id}`);
    expect(response.status).toBe(204);

    expect((await client.get(`/api/v1/monitors/${monitor.id}`)).status).toBe(404);
    expect(await prisma.checkResult.count({ where: { monitorId: monitor.id } })).toBe(0);
  });

  it('cannot delete another account’s monitor', async () => {
    const owner = await signedIn();
    const stranger = await signedIn();
    const monitor = await createMonitor(owner.client);

    expect((await stranger.client.delete(`/api/v1/monitors/${monitor.id}`)).status).toBe(404);
    expect((await owner.client.get(`/api/v1/monitors/${monitor.id}`)).status).toBe(200);
  });
});

describe('GET /api/v1/meta/limits', () => {
  it('is public and describes the platform limits the UI must enforce', async () => {
    const response = await createTestContext().client.get('/api/v1/meta/limits');

    expect(response.status).toBe(200);
    expect(response.body.limits.minIntervalSeconds).toBe(limits.minIntervalSeconds);
    expect(response.body.defaults).toMatchObject({
      intervalSeconds: 60,
      timeoutMs: 10_000,
      expectedStatusMin: 200,
      expectedStatusMax: 299,
    });
    expect(response.body.timeWindows).toContain('24h');
    expect(response.body.timeWindowBuckets['24h']).toBeGreaterThan(0);
  });
});

describe('account isolation', () => {
  it('keeps monitor counts and history per account', async () => {
    const first = await signedIn();
    const second = await signedIn();

    await createMonitor(first.client, { name: 'First only' });
    await seedMonitor(second.userId, { name: 'Second only' });

    const firstList = await first.client.get('/api/v1/monitors');
    const secondList = await second.client.get('/api/v1/monitors');

    expect(firstList.body.items as MonitorDto[]).toHaveLength(1);
    expect(secondList.body.items as MonitorDto[]).toHaveLength(1);
    expect((firstList.body.items as MonitorDto[])[0]?.name).toBe('First only');
    expect((secondList.body.items as MonitorDto[])[0]?.name).toBe('Second only');
    expect(uniqueEmail).toBeTypeOf('function');
  });
});
