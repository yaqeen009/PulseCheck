import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, TIME_WINDOW_BUCKETS } from '@pulsecheck/shared';
import type {
  CheckResultDto,
  IncidentDto,
  Page,
  ResponseTimesResponseDto,
  UptimeResponseDto,
} from '@pulsecheck/shared';
import { prisma } from '../../src/db.js';
import { cleanupUser, createTestContext, seedCheckResults, signUp } from '../helpers/factories.js';
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

async function createMonitor(client: TestClient, name = 'History API'): Promise<string> {
  const response = await client.post('/api/v1/monitors', {
    name,
    url: 'https://example.com/health',
  });
  return response.body.monitor.id as string;
}

const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * 60_000);

describe('GET /api/v1/monitors/:id/checks', () => {
  it('paginates check history, newest first', async () => {
    const { client } = await signedIn();
    const monitorId = await createMonitor(client);
    await seedCheckResults(
      monitorId,
      Array.from({ length: 5 }, (_, index) => ({
        checkedAt: minutesAgo(index + 1),
        success: index !== 2,
        responseTimeMs: 100 + index,
        httpStatusCode: index === 2 ? 500 : 200,
      })),
    );

    const first = await client.get(`/api/v1/monitors/${monitorId}/checks?page=1&pageSize=2`);
    expect(first.status).toBe(200);
    const page = first.body as Page<CheckResultDto>;
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(5);
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(2);
    expect(page.totalPages).toBe(3);
    expect(page.hasMore).toBe(true);
    expect(new Date(page.items[0]!.checkedAt).getTime()).toBeGreaterThan(
      new Date(page.items[1]!.checkedAt).getTime(),
    );

    const third = await client.get(`/api/v1/monitors/${monitorId}/checks?page=3&pageSize=2`);
    expect((third.body as Page<CheckResultDto>).hasMore).toBe(false);
    expect((third.body as Page<CheckResultDto>).items).toHaveLength(1);
  });

  it('filters by success and shows the failure detail', async () => {
    const { client } = await signedIn();
    const monitorId = await createMonitor(client);
    await seedCheckResults(monitorId, [
      { success: true, responseTimeMs: 100, httpStatusCode: 200 },
      {
        success: false,
        responseTimeMs: 250,
        httpStatusCode: null,
        errorCategory: 'TIMEOUT',
        errorMessage: 'no response within 2000 ms',
      },
    ]);

    const failed = await client.get(`/api/v1/monitors/${monitorId}/checks?success=false`);
    const body = failed.body as Page<CheckResultDto>;
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({
      success: false,
      errorCategory: 'TIMEOUT',
      errorMessage: 'no response within 2000 ms',
      httpStatusCode: null,
    });

    const succeeded = await client.get(`/api/v1/monitors/${monitorId}/checks?success=true`);
    expect((succeeded.body as Page<CheckResultDto>).total).toBe(1);
  });

  it('bounds the page size', async () => {
    const { client } = await signedIn();
    const monitorId = await createMonitor(client);

    const tooLarge = await client.get(
      `/api/v1/monitors/${monitorId}/checks?pageSize=${DEFAULT_LIMITS.maxPageSize + 1}`,
    );
    expect(tooLarge.status).toBe(400);
    expect(tooLarge.body.error.code).toBe('VALIDATION_ERROR');

    expect((await client.get(`/api/v1/monitors/${monitorId}/checks?page=0`)).status).toBe(400);
    expect((await client.get(`/api/v1/monitors/${monitorId}/checks?pageSize=abc`)).status).toBe(
      400,
    );
  });

  it('does not expose another account’s history', async () => {
    const owner = await signedIn();
    const stranger = await signedIn();
    const monitorId = await createMonitor(owner.client);
    await seedCheckResults(monitorId, [{ success: true, responseTimeMs: 10 }]);

    expect((await stranger.client.get(`/api/v1/monitors/${monitorId}/checks`)).status).toBe(404);
  });
});

describe('GET /api/v1/monitors/:id/uptime', () => {
  it('returns the requested window with honest aggregate stats', async () => {
    const { client } = await signedIn();
    const monitorId = await createMonitor(client);
    await seedCheckResults(monitorId, [
      { checkedAt: minutesAgo(1), success: true, responseTimeMs: 100, httpStatusCode: 200 },
      { checkedAt: minutesAgo(2), success: true, responseTimeMs: 300, httpStatusCode: 200 },
      { checkedAt: minutesAgo(3), success: false, responseTimeMs: 500, httpStatusCode: 500 },
    ]);

    const response = await client.get(`/api/v1/monitors/${monitorId}/uptime?window=1h`);
    expect(response.status).toBe(200);

    const body = response.body as UptimeResponseDto;
    expect(body.monitorId).toBe(monitorId);
    expect(body.window).toBe('1h');
    expect(body.stats.totalChecks).toBe(3);
    expect(body.stats.successfulChecks).toBe(2);
    expect(body.stats.uptimePercent).toBe(66.67);
    expect(body.stats.availabilityPercent).toBe(100);
    expect(body.stats.avgResponseTimeMs).toBe(300);
    expect(new Date(body.from).getTime()).toBeLessThan(new Date(body.to).getTime());
  });

  it('reports null, not 0, for a monitor with no checks yet', async () => {
    const { client } = await signedIn();
    const monitorId = await createMonitor(client);

    const response = await client.get(`/api/v1/monitors/${monitorId}/uptime`);
    const body = response.body as UptimeResponseDto;

    expect(body.window).toBe('24h');
    expect(body.stats.totalChecks).toBe(0);
    expect(body.stats.uptimePercent).toBeNull();
    expect(body.stats.availabilityPercent).toBeNull();
    expect(body.stats.avgResponseTimeMs).toBeNull();
  });

  it('rejects an unsupported window', async () => {
    const { client } = await signedIn();
    const monitorId = await createMonitor(client);

    const response = await client.get(`/api/v1/monitors/${monitorId}/uptime?window=all-time`);
    expect(response.status).toBe(400);
  });
});

describe('GET /api/v1/monitors/:id/response-times', () => {
  it('returns a fixed number of buckets with null gaps', async () => {
    const { client } = await signedIn();
    const monitorId = await createMonitor(client);
    await seedCheckResults(monitorId, [
      { checkedAt: minutesAgo(2), success: true, responseTimeMs: 100, httpStatusCode: 200 },
      { checkedAt: minutesAgo(2), success: true, responseTimeMs: 200, httpStatusCode: 200 },
      { checkedAt: minutesAgo(40), success: false, responseTimeMs: 900, httpStatusCode: null },
    ]);

    const response = await client.get(`/api/v1/monitors/${monitorId}/response-times?window=1h`);
    expect(response.status).toBe(200);

    const body = response.body as ResponseTimesResponseDto;
    expect(body.points).toHaveLength(TIME_WINDOW_BUCKETS['1h']);
    expect(body.points.reduce((total, point) => total + point.checks, 0)).toBe(3);
    expect(body.points.reduce((total, point) => total + point.failures, 0)).toBe(1);

    const empty = body.points.filter((point) => point.checks === 0);
    expect(empty.length).toBeGreaterThan(0);
    expect(empty.every((point) => point.avgResponseTimeMs === null)).toBe(true);

    const filled = body.points.filter((point) => point.checks > 0);
    expect(filled.every((point) => point.timestamp)).toBe(true);
  });
});

describe('incident history', () => {
  async function seedIncidents(monitorId: string): Promise<void> {
    await prisma.incident.create({
      data: {
        monitorId,
        startedAt: minutesAgo(90),
        resolvedAt: minutesAgo(60),
        initialStatus: 'DEGRADED',
        peakStatus: 'DOWN',
        latestErrorSummary: 'connection refused',
        failedCheckCount: 4,
      },
    });
    await prisma.incident.create({
      data: {
        monitorId,
        startedAt: minutesAgo(10),
        initialStatus: 'DOWN',
        peakStatus: 'DOWN',
        latestErrorSummary: 'timeout',
        failedCheckCount: 1,
      },
    });
  }

  it('lists incidents for one monitor with filters and pagination', async () => {
    const { client } = await signedIn();
    const monitorId = await createMonitor(client, 'Incident API');
    await seedIncidents(monitorId);

    const all = await client.get(`/api/v1/monitors/${monitorId}/incidents`);
    expect(all.status).toBe(200);
    const page = all.body as Page<IncidentDto>;
    expect(page.total).toBe(2);
    expect(page.items[0]).toMatchObject({
      monitorId,
      monitorName: 'Incident API',
      initialStatus: 'DOWN',
      ongoing: true,
      durationMs: null,
    });
    expect(page.items[1]).toMatchObject({
      initialStatus: 'DEGRADED',
      peakStatus: 'DOWN',
      ongoing: false,
      failedCheckCount: 4,
    });
    expect(page.items[1]!.durationMs).toBe(30 * 60_000);

    const open = await client.get(`/api/v1/monitors/${monitorId}/incidents?status=open`);
    expect((open.body as Page<IncidentDto>).total).toBe(1);

    const resolved = await client.get(`/api/v1/monitors/${monitorId}/incidents?status=resolved`);
    expect((resolved.body as Page<IncidentDto>).total).toBe(1);

    const sized = await client.get(`/api/v1/monitors/${monitorId}/incidents?pageSize=1&page=2`);
    expect((sized.body as Page<IncidentDto>).hasMore).toBe(false);
  });

  it('lists account-wide incidents across monitors', async () => {
    const { client } = await signedIn();
    const first = await createMonitor(client, 'First');
    const second = await createMonitor(client, 'Second');
    await prisma.incident.createMany({
      data: [
        {
          monitorId: first,
          startedAt: minutesAgo(30),
          initialStatus: 'DOWN',
          peakStatus: 'DOWN',
          failedCheckCount: 1,
        },
        {
          monitorId: second,
          startedAt: minutesAgo(20),
          initialStatus: 'DEGRADED',
          peakStatus: 'DEGRADED',
          failedCheckCount: 2,
        },
      ],
    });

    const response = await client.get('/api/v1/incidents');
    expect(response.status).toBe(200);
    const page = response.body as Page<IncidentDto>;
    expect(page.total).toBe(2);
    expect(page.items.map((incident) => incident.monitorName).sort()).toEqual(['First', 'Second']);
    expect(page.items[0]!.monitorName).toBe('Second');
  });

  it('never lists another account’s incidents', async () => {
    const owner = await signedIn();
    const stranger = await signedIn();
    const monitorId = await createMonitor(owner.client);
    await seedIncidents(monitorId);

    const response = await stranger.client.get('/api/v1/incidents');
    expect((response.body as Page<IncidentDto>).total).toBe(0);
    expect((await stranger.client.get(`/api/v1/monitors/${monitorId}/incidents`)).status).toBe(404);
  });

  it('rejects an unknown status filter', async () => {
    const { client } = await signedIn();
    const monitorId = await createMonitor(client);
    expect(
      (await client.get(`/api/v1/monitors/${monitorId}/incidents?status=exploded`)).status,
    ).toBe(400);
  });
});
