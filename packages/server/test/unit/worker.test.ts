import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db.js';
import {
  claimMonitor,
  computeNextCheckAt,
  executeAndRecordCheck,
  pruneOldCheckResults,
  runCheckForMonitor,
} from '../../src/monitoring/worker.js';
import { closeOutboundDispatcher, testPolicy } from '../../src/monitoring/checker.js';
import { cleanupUser, createUser, seedMonitor } from '../helpers/factories.js';
import { startStaticServer, type MockServer } from '../helpers/mock-server.js';

const policy = testPolicy();
const createdUsers: string[] = [];
const servers: MockServer[] = [];

beforeAll(() => {
  process.env.BLOCK_PRIVATE_NETWORKS = 'false';
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const userId of createdUsers.splice(0)) await cleanupUser(userId);
});

afterAll(async () => {
  await closeOutboundDispatcher();
  await prisma.$disconnect();
});

async function user(): Promise<string> {
  const created = await createUser();
  createdUsers.push(created.id);
  return created.id;
}

async function mock(options: Parameters<typeof startStaticServer>[0]): Promise<MockServer> {
  const server = await startStaticServer(options);
  servers.push(server);
  return server;
}

describe('computeNextCheckAt', () => {
  it('schedules the next check after the interval, within a 10% jitter band', () => {
    const completedAt = new Date('2026-10-18T12:00:00.000Z');

    const earliest = computeNextCheckAt(completedAt, 60, () => 0);
    const latest = computeNextCheckAt(completedAt, 60, () => 1);

    expect(earliest.toISOString()).toBe('2026-10-18T12:01:00.000Z');
    expect(latest.getTime() - earliest.getTime()).toBe(6_000);
  });

  it('always schedules strictly in the future', () => {
    const completedAt = new Date();
    expect(computeNextCheckAt(completedAt, 30, () => 0).getTime()).toBeGreaterThan(
      completedAt.getTime(),
    );
  });
});

describe('claimMonitor', () => {
  it('lets exactly one worker claim a due monitor', async () => {
    const userId = await user();
    const monitor = await seedMonitor(userId);

    const first = await claimMonitor(monitor.id, 30_000, randomUUID());
    const second = await claimMonitor(monitor.id, 30_000, randomUUID());

    expect(first).toBe(true);
    expect(second).toBe(false);

    const stored = await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(stored.leaseToken).not.toBeNull();
  });

  it('does not claim a monitor whose next check is in the future', async () => {
    const userId = await user();
    const monitor = await seedMonitor(userId);
    await prisma.monitor.update({
      where: { id: monitor.id },
      data: { nextCheckAt: new Date(Date.now() + 60_000) },
    });

    expect(await claimMonitor(monitor.id, 30_000, randomUUID())).toBe(false);
  });

  it('never claims a disabled monitor', async () => {
    const userId = await user();
    const monitor = await seedMonitor(userId, { enabled: false });
    expect(await claimMonitor(monitor.id, 30_000, randomUUID())).toBe(false);
  });

  it('reclaims a monitor whose lease expired, so a crashed worker cannot stall it', async () => {
    const userId = await user();
    const monitor = await seedMonitor(userId);
    await claimMonitor(monitor.id, 30_000, randomUUID());

    await prisma.monitor.update({
      where: { id: monitor.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });

    expect(await claimMonitor(monitor.id, 30_000, randomUUID())).toBe(true);
  });
});

describe('runCheckForMonitor', () => {
  it('returns null for a monitor that is no longer enabled', async () => {
    const userId = await user();
    const monitor = await seedMonitor(userId, { enabled: false });

    expect(await runCheckForMonitor(monitor.id, { policy })).toBeNull();
    expect(await prisma.checkResult.count({ where: { monitorId: monitor.id } })).toBe(0);
  });

  it('returns null when the lease is already held', async () => {
    const userId = await user();
    const server = await mock({ status: 200 });
    const monitor = await seedMonitor(userId, { url: server.url });
    await claimMonitor(monitor.id, 30_000, randomUUID());

    expect(await runCheckForMonitor(monitor.id, { policy })).toBeNull();
    expect(server.requests).toHaveLength(0);
  });

  it('records a successful check and leaves the lease released', async () => {
    const userId = await user();
    const server = await mock({ status: 200 });
    const monitor = await seedMonitor(userId, { url: server.url });

    const recorded = await runCheckForMonitor(monitor.id, { policy });
    expect(recorded).not.toBeNull();

    const stored = await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(stored.status).toBe('HEALTHY');
    expect(stored.lastCheckedAt).not.toBeNull();
    expect(stored.lastStatusChangeAt).not.toBeNull();
    expect(stored.consecutiveFailures).toBe(0);
    expect(stored.leaseToken).toBeNull();
    expect(stored.leaseExpiresAt).toBeNull();
    expect(stored.nextCheckAt.getTime()).toBeGreaterThan(Date.now());

    const results = await prisma.checkResult.findMany({ where: { monitorId: monitor.id } });
    expect(results).toHaveLength(1);
    expect(results[0]?.success).toBe(true);
    expect(results[0]?.httpStatusCode).toBe(200);
    expect(await prisma.incident.count({ where: { monitorId: monitor.id } })).toBe(0);
  });
});

describe('status transitions and incident bookkeeping', () => {
  it('opens one incident per outage and resolves it on recovery', async () => {
    const userId = await user();
    const failing = await mock({ status: 500 });
    const monitor = await seedMonitor(userId, { url: failing.url });

    // 1. first failure: PENDING -> DEGRADED opens an incident
    const first = await executeAndRecordCheck(
      await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } }),
      { policy },
    );
    expect(first.previousStatus).toBe('PENDING');
    expect(first.status).toBe('DEGRADED');
    expect(first.incidentOpened).toBe(true);

    let incidents = await prisma.incident.findMany({ where: { monitorId: monitor.id } });
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.initialStatus).toBe('DEGRADED');
    expect(incidents[0]?.peakStatus).toBe('DEGRADED');
    expect(incidents[0]?.failedCheckCount).toBe(1);
    expect(incidents[0]?.resolvedAt).toBeNull();
    expect(incidents[0]?.latestErrorSummary).toContain('expected 200-299, received 500');

    // 2. second failure: the same incident accumulates, no duplicate is created
    const second = await executeAndRecordCheck(
      await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } }),
      { policy },
    );
    expect(second.incidentOpened).toBe(false);
    expect(second.incidentResolved).toBe(false);

    incidents = await prisma.incident.findMany({ where: { monitorId: monitor.id } });
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.failedCheckCount).toBe(2);

    // 3. recovery: the incident is resolved and the monitor is healthy again
    const healthy = await mock({ status: 200 });
    await prisma.monitor.update({ where: { id: monitor.id }, data: { url: healthy.url } });

    const third = await executeAndRecordCheck(
      await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } }),
      { policy },
    );
    expect(third.status).toBe('HEALTHY');
    expect(third.incidentResolved).toBe(true);

    incidents = await prisma.incident.findMany({ where: { monitorId: monitor.id } });
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.resolvedAt).not.toBeNull();

    const stored = await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(stored.status).toBe('HEALTHY');
    expect(stored.consecutiveFailures).toBe(0);
    expect(await prisma.checkResult.count({ where: { monitorId: monitor.id } })).toBe(3);
  });

  it('never downgrades the peak status of an ongoing incident', async () => {
    const userId = await user();

    // 1. nothing is listening -> DOWN, which opens the incident.
    const throwaway = await mock({ status: 200 });
    const closedPort = throwaway.port;
    await throwaway.close();
    servers.splice(servers.indexOf(throwaway), 1);

    const monitor = await seedMonitor(userId, {
      url: `http://127.0.0.1:${closedPort}/health`,
      timeoutMs: 1_000,
    });

    const first = await executeAndRecordCheck(
      await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } }),
      { policy },
    );
    expect(first.status).toBe('DOWN');
    expect(first.incidentOpened).toBe(true);

    // 2. the target answers again but with the wrong status -> DEGRADED. The
    // incident must keep the more severe DOWN as its peak.
    const wrongStatus = await mock({ status: 500 });
    await prisma.monitor.update({ where: { id: monitor.id }, data: { url: wrongStatus.url } });

    const second = await executeAndRecordCheck(
      await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } }),
      { policy },
    );

    expect(second.status).toBe('DEGRADED');
    expect(second.incidentOpened).toBe(false);

    const incidents = await prisma.incident.findMany({ where: { monitorId: monitor.id } });
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.initialStatus).toBe('DOWN');
    expect(incidents[0]?.peakStatus).toBe('DOWN');
    expect(incidents[0]?.failedCheckCount).toBe(2);
  });

  it('keeps a monitor PAUSED when it was disabled while the check was in flight', async () => {
    const userId = await user();
    const server = await mock({ status: 200 });
    const monitor = await seedMonitor(userId, { url: server.url });

    // Simulate the user pausing the monitor during the request.
    await prisma.monitor.update({ where: { id: monitor.id }, data: { enabled: false } });

    const recorded = await executeAndRecordCheck(
      await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } }),
      { policy },
    );

    expect(recorded.status).toBe('HEALTHY'); // the outcome itself is recorded honestly
    const stored = await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(stored.status).toBe('PAUSED');
    expect(await prisma.incident.count({ where: { monitorId: monitor.id } })).toBe(0);
    // A paused monitor's schedule is left untouched.
    expect(stored.nextCheckAt.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
  });

  it('counts consecutive failures and resets the counter on success', async () => {
    const userId = await user();
    const failing = await mock({ status: 503 });
    const monitor = await seedMonitor(userId, { url: failing.url });

    await executeAndRecordCheck(
      await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } }),
      { policy },
    );
    await executeAndRecordCheck(
      await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } }),
      { policy },
    );
    expect(
      (await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } })).consecutiveFailures,
    ).toBe(2);

    const healthy = await mock({ status: 200 });
    await prisma.monitor.update({ where: { id: monitor.id }, data: { url: healthy.url } });
    await executeAndRecordCheck(
      await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } }),
      { policy },
    );
    expect(
      (await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } })).consecutiveFailures,
    ).toBe(0);
  });
});

describe('pruneOldCheckResults', () => {
  it('deletes only results older than the retention window', async () => {
    const userId = await user();
    const monitor = await seedMonitor(userId);
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1_000);
    const recent = new Date(Date.now() - 60 * 1_000);

    await prisma.checkResult.createMany({
      data: [
        {
          monitorId: monitor.id,
          checkedAt: old,
          completedAt: old,
          success: true,
          httpStatusCode: 200,
          responseTimeMs: 10,
        },
        {
          monitorId: monitor.id,
          checkedAt: old,
          completedAt: old,
          success: false,
          httpStatusCode: null,
          responseTimeMs: 5,
          errorCategory: 'TIMEOUT',
        },
        {
          monitorId: monitor.id,
          checkedAt: recent,
          completedAt: recent,
          success: true,
          httpStatusCode: 200,
          responseTimeMs: 12,
        },
      ],
    });

    const deleted = await pruneOldCheckResults(30);
    expect(deleted).toBe(2);
    expect(await prisma.checkResult.count({ where: { monitorId: monitor.id } })).toBe(1);
  });
});

describe('concurrent claims', () => {
  it('only one of many concurrent workers wins the lease', async () => {
    const userId = await user();
    const monitor = await seedMonitor(userId);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => claimMonitor(monitor.id, 30_000, randomUUID())),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
