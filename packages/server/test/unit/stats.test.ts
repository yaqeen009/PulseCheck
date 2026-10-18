import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  TIME_WINDOW_BUCKETS,
  TIME_WINDOW_MS,
  bucketIndexFor,
  computeUptime,
} from '@pulsecheck/shared';
import { prisma } from '../../src/db.js';
import {
  getDashboardSummary,
  getMonitorDetail,
  getMonitorResponseTimes,
  getMonitorUptime,
  getRecentActivity,
  listCheckResults,
  listIncidents,
} from '../../src/services/stats-service.js';
import { cleanupUser, createUser, seedCheckResults, seedMonitor } from '../helpers/factories.js';

const createdUsers: string[] = [];

afterEach(async () => {
  for (const userId of createdUsers.splice(0)) await cleanupUser(userId);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function user(): Promise<string> {
  const created = await createUser();
  createdUsers.push(created.id);
  return created.id;
}

const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * 60_000);

describe('getMonitorUptime', () => {
  it('returns the null-shaped stats for a monitor with no checks', async () => {
    const userId = await user();
    const monitor = await seedMonitor(userId);

    const result = await getMonitorUptime(userId, monitor.id, '24h');

    expect(result.monitorId).toBe(monitor.id);
    expect(result.window).toBe('24h');
    expect(result.stats).toEqual(computeUptime([]));
    expect(result.stats.uptimePercent).toBeNull();
  });

  it('aggregates in SQL consistently with the shared implementation', async () => {
    const userId = await user();
    const monitor = await seedMonitor(userId);

    const samples = [
      { success: true, responseTimeMs: 120, httpStatusCode: 200 },
      { success: true, responseTimeMs: 180, httpStatusCode: 200 },
      { success: false, responseTimeMs: 640, httpStatusCode: 500 },
      { success: false, responseTimeMs: 900, httpStatusCode: null },
      { success: true, responseTimeMs: 240, httpStatusCode: 201 },
    ];

    await seedCheckResults(
      monitor.id,
      samples.map((sample, index) => ({ ...sample, checkedAt: minutesAgo(index + 1) })),
    );

    const result = await getMonitorUptime(userId, monitor.id, '1h');
    const expected = computeUptime(samples);

    expect(result.stats.totalChecks).toBe(expected.totalChecks);
    expect(result.stats.successfulChecks).toBe(expected.successfulChecks);
    expect(result.stats.failedChecks).toBe(expected.failedChecks);
    expect(result.stats.respondedChecks).toBe(expected.respondedChecks);
    expect(result.stats.uptimePercent).toBe(expected.uptimePercent);
    expect(result.stats.availabilityPercent).toBe(expected.availabilityPercent);
    expect(result.stats.avgResponseTimeMs).toBe(expected.avgResponseTimeMs);
    expect(result.stats.minResponseTimeMs).toBe(expected.minResponseTimeMs);
    expect(result.stats.maxResponseTimeMs).toBe(expected.maxResponseTimeMs);

    // p95 deliberately differs in method: PostgreSQL interpolates
    // (`percentile_cont`) while the shared helper uses nearest-rank. Both must
    // stay inside the observed range.
    expect(result.stats.p95ResponseTimeMs).not.toBeNull();
    expect(result.stats.p95ResponseTimeMs as number).toBeGreaterThanOrEqual(
      expected.minResponseTimeMs as number,
    );
    expect(result.stats.p95ResponseTimeMs as number).toBeLessThanOrEqual(
      expected.maxResponseTimeMs as number,
    );
  });

  it('excludes checks older than the requested window', async () => {
    const userId = await user();
    const monitor = await seedMonitor(userId);
    await seedCheckResults(monitor.id, [
      { checkedAt: minutesAgo(10), success: true, responseTimeMs: 100 },
      { checkedAt: minutesAgo(120), success: true, responseTimeMs: 100 },
      { checkedAt: minutesAgo(60 * 30), success: true, responseTimeMs: 100 },
    ]);

    expect((await getMonitorUptime(userId, monitor.id, '1h')).stats.totalChecks).toBe(1);
    expect((await getMonitorUptime(userId, monitor.id, '24h')).stats.totalChecks).toBe(2);
    expect((await getMonitorUptime(userId, monitor.id, '30d')).stats.totalChecks).toBe(3);
  });
});

describe('getMonitorResponseTimes', () => {
  it('returns a fixed number of buckets with null metrics where there is no data', async () => {
    const userId = await user();
    const monitor = await seedMonitor(userId);

    const result = await getMonitorResponseTimes(userId, monitor.id, '1h');

    expect(result.points).toHaveLength(TIME_WINDOW_BUCKETS['1h']);
    expect(result.points.every((point) => point.checks === 0)).toBe(true);
    expect(result.points.every((point) => point.avgResponseTimeMs === null)).toBe(true);
    expect(result.points[0]?.timestamp).toBe(result.from);
    expect(new Date(result.from).getTime()).toBeLessThan(new Date(result.to).getTime());
  });

  it('places checks in ascending, non-overlapping buckets', async () => {
    const userId = await user();
    const monitor = await seedMonitor(userId);
    const now = new Date();
    await seedCheckResults(monitor.id, [
      { checkedAt: new Date(now.getTime() - 5 * 60_000), responseTimeMs: 100, success: true },
      { checkedAt: new Date(now.getTime() - 6 * 60_000), responseTimeMs: 300, success: true },
      {
        checkedAt: new Date(now.getTime() - 6 * 60_000),
        responseTimeMs: 500,
        success: false,
        httpStatusCode: 500,
      },
      {
        checkedAt: new Date(now.getTime() - 50 * 60_000),
        responseTimeMs: 900,
        success: false,
        httpStatusCode: null,
      },
    ]);

    const result = await getMonitorResponseTimes(userId, monitor.id, '1h');
    const from = new Date(result.from).getTime();
    const populate = result.points.filter((point) => point.checks > 0);

    expect(result.points.reduce((total, point) => total + point.checks, 0)).toBe(4);
    expect(result.points.reduce((total, point) => total + point.failures, 0)).toBe(2);
    expect(populate.length).toBeGreaterThan(0);

    const observed = populate.map((point) =>
      bucketIndexFor(
        '1h',
        new Date(point.timestamp).getTime(),
        new Date(from + TIME_WINDOW_MS['1h']),
      ),
    );
    // Bucket indexes are strictly ascending and inside the window.
    for (let index = 1; index < observed.length; index += 1) {
      expect((observed[index] as number) > (observed[index - 1] as number)).toBe(true);
    }
    for (const point of populate) {
      expect(point.avgResponseTimeMs).toBeGreaterThan(0);
      expect(point.minResponseTimeMs as number).toBeLessThanOrEqual(
        point.maxResponseTimeMs as number,
      );
    }
  });
});

describe('listCheckResults', () => {
  it('paginates newest-first and reports honest page metadata', async () => {
    const userId = await user();
    const monitor = await seedMonitor(userId);
    await seedCheckResults(
      monitor.id,
      Array.from({ length: 7 }, (_, index) => ({
        checkedAt: minutesAgo(index + 1),
        success: index % 2 === 0,
        responseTimeMs: 10 * (index + 1),
      })),
    );

    const first = await listCheckResults(userId, monitor.id, { page: 1, pageSize: 3 });
    expect(first.items).toHaveLength(3);
    expect(first.total).toBe(7);
    expect(first.totalPages).toBe(3);
    expect(first.hasMore).toBe(true);
    expect(new Date(first.items[0]!.checkedAt).getTime()).toBeGreaterThan(
      new Date(first.items[1]!.checkedAt).getTime(),
    );

    const last = await listCheckResults(userId, monitor.id, { page: 3, pageSize: 3 });
    expect(last.items).toHaveLength(1);
    expect(last.hasMore).toBe(false);
  });

  it('filters by success when asked', async () => {
    const userId = await user();
    const monitor = await seedMonitor(userId);
    await seedCheckResults(monitor.id, [
      { success: true, responseTimeMs: 10 },
      {
        success: false,
        responseTimeMs: 20,
        httpStatusCode: 500,
        errorCategory: 'UNEXPECTED_STATUS',
      },
    ]);

    expect(
      (await listCheckResults(userId, monitor.id, { page: 1, pageSize: 10, success: false })).total,
    ).toBe(1);
    expect(
      (await listCheckResults(userId, monitor.id, { page: 1, pageSize: 10, success: true })).total,
    ).toBe(1);
  });
});

describe('incidents', () => {
  async function seedIncident(monitorId: string, resolved: boolean) {
    return prisma.incident.create({
      data: {
        monitorId,
        startedAt: minutesAgo(30),
        resolvedAt: resolved ? minutesAgo(20) : null,
        initialStatus: 'DOWN',
        peakStatus: 'DOWN',
        latestErrorSummary: 'connection refused',
        failedCheckCount: 3,
      },
    });
  }

  it('maps an incident to its DTO, including duration and ongoing flag', async () => {
    const userId = await user();
    const monitor = await seedMonitor(userId, { name: 'Payments API' });
    await seedIncident(monitor.id, true);
    await seedIncident(monitor.id, false);

    const page = await listIncidents(userId, { page: 1, pageSize: 10, status: 'all' });
    expect(page.total).toBe(2);
    expect(page.items.every((incident) => incident.monitorName === 'Payments API')).toBe(true);

    const open = page.items.find((incident) => incident.ongoing);
    const resolved = page.items.find((incident) => !incident.ongoing);
    expect(open?.durationMs).toBeNull();
    expect(resolved?.durationMs).toBe(10 * 60_000);

    expect((await listIncidents(userId, { page: 1, pageSize: 10, status: 'open' })).total).toBe(1);
    expect((await listIncidents(userId, { page: 1, pageSize: 10, status: 'resolved' })).total).toBe(
      1,
    );
  });

  it('never returns another account’s incidents', async () => {
    const owner = await user();
    const stranger = await user();
    const monitor = await seedMonitor(owner);
    await seedIncident(monitor.id, false);

    expect((await listIncidents(stranger, { page: 1, pageSize: 10, status: 'all' })).total).toBe(0);
  });
});

describe('getDashboardSummary', () => {
  it('reports zeroes and null percentages for a brand-new account', async () => {
    const userId = await user();
    const summary = await getDashboardSummary(userId);

    expect(summary.monitors).toEqual({
      total: 0,
      healthy: 0,
      degraded: 0,
      down: 0,
      paused: 0,
      pending: 0,
    });
    expect(summary.uptime.stats.uptimePercent).toBeNull();
    expect(summary.openIncidents).toBe(0);
    expect(summary.incidentsLast24h).toBe(0);
    expect(summary.checksLast24h).toEqual({
      total: 0,
      failed: 0,
      successRatePercent: null,
    });
    expect(summary.slowestMonitors).toEqual([]);
  });

  it('derives every number from stored check results', async () => {
    const userId = await user();
    const healthy = await seedMonitor(userId, { name: 'Healthy', status: 'HEALTHY' });
    const down = await seedMonitor(userId, { name: 'Down', status: 'DOWN' });
    await seedMonitor(userId, { name: 'Paused', status: 'PAUSED', enabled: false });

    await seedCheckResults(healthy.id, [
      { checkedAt: minutesAgo(2), success: true, responseTimeMs: 100 },
      { checkedAt: minutesAgo(3), success: true, responseTimeMs: 200 },
      { checkedAt: minutesAgo(4), success: true, responseTimeMs: 300 },
      {
        checkedAt: minutesAgo(5),
        success: false,
        responseTimeMs: 400,
        httpStatusCode: 500,
        errorCategory: 'UNEXPECTED_STATUS',
      },
    ]);
    await seedCheckResults(down.id, [
      {
        checkedAt: minutesAgo(6),
        success: false,
        responseTimeMs: 5,
        httpStatusCode: null,
        errorCategory: 'CONNECT',
      },
    ]);

    await prisma.incident.create({
      data: {
        monitorId: down.id,
        startedAt: minutesAgo(7),
        initialStatus: 'DOWN',
        peakStatus: 'DOWN',
        latestErrorSummary: 'connection refused',
        failedCheckCount: 1,
      },
    });

    const summary = await getDashboardSummary(userId);

    expect(summary.monitors).toEqual({
      total: 3,
      healthy: 1,
      degraded: 0,
      down: 1,
      paused: 1,
      pending: 0,
    });
    expect(summary.checksLast24h.total).toBe(5);
    expect(summary.checksLast24h.failed).toBe(2);
    expect(summary.checksLast24h.successRatePercent).toBe(60);
    expect(summary.uptime.stats.totalChecks).toBe(5);
    expect(summary.uptime.stats.uptimePercent).toBe(60);
    expect(summary.openIncidents).toBe(1);
    expect(summary.incidentsLast24h).toBe(1);

    // Only monitors with at least 3 checks in the window appear in "slowest".
    expect(summary.slowestMonitors).toHaveLength(1);
    expect(summary.slowestMonitors[0]).toMatchObject({
      monitorId: healthy.id,
      name: 'Healthy',
      avgResponseTimeMs: 250,
      uptimePercent: 75,
      status: 'HEALTHY',
    });
  });
});

describe('getRecentActivity', () => {
  it('returns the newest checks and incidents with their monitor name', async () => {
    const userId = await user();
    const monitor = await seedMonitor(userId, { name: 'Search API' });
    await seedCheckResults(
      monitor.id,
      Array.from({ length: 20 }, (_, index) => ({
        checkedAt: minutesAgo(index + 1),
        success: true,
        responseTimeMs: 50,
      })),
    );
    await prisma.incident.create({
      data: {
        monitorId: monitor.id,
        startedAt: minutesAgo(5),
        initialStatus: 'DEGRADED',
        peakStatus: 'DEGRADED',
        failedCheckCount: 2,
      },
    });

    const activity = await getRecentActivity(userId);

    expect(activity.recentChecks).toHaveLength(12);
    expect(activity.recentChecks.every((check) => check.monitorName === 'Search API')).toBe(true);
    expect(new Date(activity.recentChecks[0]!.checkedAt).getTime()).toBeGreaterThan(
      new Date(activity.recentChecks[1]!.checkedAt).getTime(),
    );
    expect(activity.recentIncidents).toHaveLength(1);
    expect(activity.recentIncidents[0]?.monitorName).toBe('Search API');
  });

  it('returns empty arrays for an account with no history', async () => {
    const userId = await user();
    expect(await getRecentActivity(userId)).toEqual({ recentChecks: [], recentIncidents: [] });
  });
});

describe('getMonitorDetail', () => {
  it('returns the monitor together with its latest check, or null', async () => {
    const userId = await user();
    const monitor = await seedMonitor(userId);

    expect((await getMonitorDetail(userId, monitor.id)).latestCheck).toBeNull();

    await seedCheckResults(monitor.id, [
      { checkedAt: minutesAgo(10), success: true, responseTimeMs: 100 },
      { checkedAt: minutesAgo(1), success: false, responseTimeMs: 200, httpStatusCode: 500 },
    ]);

    const detail = await getMonitorDetail(userId, monitor.id);
    expect(detail.monitor.id).toBe(monitor.id);
    expect(detail.latestCheck?.success).toBe(false);
    expect(detail.latestCheck?.httpStatusCode).toBe(500);
  });
});

describe('ownership', () => {
  it('refuses to read another account’s monitor history', async () => {
    const owner = await user();
    const stranger = await user();
    const monitor = await seedMonitor(owner);

    await expect(getMonitorUptime(stranger, monitor.id, '24h')).rejects.toThrow(/not found/i);
    await expect(getMonitorResponseTimes(stranger, monitor.id, '24h')).rejects.toThrow(
      /not found/i,
    );
    await expect(listCheckResults(stranger, monitor.id, { page: 1, pageSize: 10 })).rejects.toThrow(
      /not found/i,
    );
    await expect(getMonitorDetail(stranger, monitor.id)).rejects.toThrow(/not found/i);
  });
});
