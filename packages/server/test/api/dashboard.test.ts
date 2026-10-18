import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { timeWindowSchema } from '@pulsecheck/shared';
import type {
  CheckResultDto,
  DashboardActivityDto,
  DashboardSummaryDto,
  IncidentActivityDto,
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

async function createMonitor(client: TestClient, name: string): Promise<string> {
  const response = await client.post('/api/v1/monitors', {
    name,
    url: 'https://example.com/health',
  });
  return response.body.monitor.id as string;
}

const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * 60_000);

describe('GET /api/v1/dashboard/summary', () => {
  it('gives a brand-new account an honest, empty dashboard', async () => {
    const { client } = await signedIn();
    const response = await client.get('/api/v1/dashboard/summary');

    expect(response.status).toBe(200);
    const summary = response.body as DashboardSummaryDto;

    expect(summary.monitors).toEqual({
      total: 0,
      healthy: 0,
      degraded: 0,
      down: 0,
      paused: 0,
      pending: 0,
    });
    expect(timeWindowSchema.safeParse(summary.uptime.window).success).toBe(true);
    expect(summary.uptime.stats.uptimePercent).toBeNull();
    expect(summary.checksLast24h).toEqual({ total: 0, failed: 0, successRatePercent: null });
    expect(summary.openIncidents).toBe(0);
    expect(summary.incidentsLast24h).toBe(0);
    expect(summary.slowestMonitors).toEqual([]);
  });

  it('reflects stored monitors and check results', async () => {
    const { client } = await signedIn();
    const healthy = await createMonitor(client, 'Healthy');
    const down = await createMonitor(client, 'Down');
    await createMonitor(client, 'Pending');

    await prisma.monitor.update({ where: { id: healthy }, data: { status: 'HEALTHY' } });
    await prisma.monitor.update({ where: { id: down }, data: { status: 'DOWN' } });

    await seedCheckResults(healthy, [
      { checkedAt: minutesAgo(1), success: true, responseTimeMs: 100, httpStatusCode: 200 },
      { checkedAt: minutesAgo(2), success: true, responseTimeMs: 200, httpStatusCode: 200 },
      { checkedAt: minutesAgo(3), success: true, responseTimeMs: 300, httpStatusCode: 200 },
    ]);
    await seedCheckResults(down, [
      {
        checkedAt: minutesAgo(4),
        success: false,
        responseTimeMs: 5,
        httpStatusCode: null,
        errorCategory: 'CONNECT',
      },
    ]);
    await prisma.incident.create({
      data: {
        monitorId: down,
        startedAt: minutesAgo(5),
        initialStatus: 'DOWN',
        peakStatus: 'DOWN',
        latestErrorSummary: 'connection refused',
        failedCheckCount: 1,
      },
    });

    const summary = (await client.get('/api/v1/dashboard/summary')).body as DashboardSummaryDto;

    expect(summary.monitors.total).toBe(3);
    expect(summary.monitors.healthy).toBe(1);
    expect(summary.monitors.down).toBe(1);
    expect(summary.monitors.pending).toBe(1);
    expect(summary.checksLast24h.total).toBe(4);
    expect(summary.checksLast24h.failed).toBe(1);
    expect(summary.checksLast24h.successRatePercent).toBe(75);
    expect(summary.uptime.stats.uptimePercent).toBe(75);
    expect(summary.openIncidents).toBe(1);
    expect(summary.incidentsLast24h).toBe(1);
    expect(summary.slowestMonitors).toEqual([
      {
        monitorId: healthy,
        name: 'Healthy',
        avgResponseTimeMs: 200,
        uptimePercent: 100,
        status: 'HEALTHY',
      },
    ]);
  });

  it('is scoped to the caller', async () => {
    const owner = await signedIn();
    const stranger = await signedIn();
    const monitorId = await createMonitor(owner.client, 'Owner only');
    await prisma.monitor.update({ where: { id: monitorId }, data: { status: 'DOWN' } });

    const summary = (await stranger.client.get('/api/v1/dashboard/summary'))
      .body as DashboardSummaryDto;
    expect(summary.monitors.total).toBe(0);
  });

  it('requires authentication', async () => {
    expect((await createTestContext().client.get('/api/v1/dashboard/summary')).status).toBe(401);
  });
});

describe('GET /api/v1/dashboard/recent-activity', () => {
  it('returns empty panels for an account with no history', async () => {
    const { client } = await signedIn();
    const response = await client.get('/api/v1/dashboard/recent-activity');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ recentChecks: [], recentIncidents: [] });
  });

  it('returns the newest checks and incidents with monitor names', async () => {
    const { client } = await signedIn();
    const monitorId = await createMonitor(client, 'Activity API');
    await seedCheckResults(
      monitorId,
      Array.from({ length: 15 }, (_, index) => ({
        checkedAt: minutesAgo(index + 1),
        success: index % 5 !== 0,
        responseTimeMs: 50 + index,
        httpStatusCode: index % 5 !== 0 ? 200 : 503,
      })),
    );
    await prisma.incident.create({
      data: {
        monitorId,
        startedAt: minutesAgo(3),
        initialStatus: 'DEGRADED',
        peakStatus: 'DEGRADED',
        latestErrorSummary: 'expected 200-299, received 503',
        failedCheckCount: 1,
      },
    });

    const activity = (await client.get('/api/v1/dashboard/recent-activity'))
      .body as DashboardActivityDto;

    expect(activity.recentChecks).toHaveLength(12);
    expect(
      activity.recentChecks.every(
        (check: CheckResultDto & { monitorName: string }) => check.monitorName === 'Activity API',
      ),
    ).toBe(true);
    expect(new Date(activity.recentChecks[0]!.checkedAt).getTime()).toBeGreaterThan(
      new Date(activity.recentChecks[1]!.checkedAt).getTime(),
    );
    expect(activity.recentChecks.some((check) => !check.success)).toBe(true);

    expect(activity.recentIncidents).toHaveLength(1);
    const incident = activity.recentIncidents[0] as IncidentActivityDto;
    expect(incident.monitorName).toBe('Activity API');
    expect(incident.ongoing).toBe(true);
    expect(incident.latestErrorSummary).toBe('expected 200-299, received 503');
  });

  it('never includes another account’s activity', async () => {
    const owner = await signedIn();
    const stranger = await signedIn();
    const monitorId = await createMonitor(owner.client, 'Private');
    await seedCheckResults(monitorId, [{ success: true, responseTimeMs: 10 }]);

    const activity = (await stranger.client.get('/api/v1/dashboard/recent-activity'))
      .body as DashboardActivityDto;
    expect(activity.recentChecks).toEqual([]);
  });
});
