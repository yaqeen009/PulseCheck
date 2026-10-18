import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db.js';
import { MonitorScheduler } from '../../src/monitoring/scheduler.js';
import { closeOutboundDispatcher } from '../../src/monitoring/checker.js';
import { cleanupUser, createUser, seedMonitor } from '../helpers/factories.js';
import { startMockServer, type MockServer } from '../helpers/mock-server.js';

const createdUsers: string[] = [];
const servers: MockServer[] = [];
const schedulers: MonitorScheduler[] = [];

afterEach(async () => {
  for (const scheduler of schedulers.splice(0)) await scheduler.stop();
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

async function mock(status = 200): Promise<MockServer> {
  const server = await startMockServer((_request, response) => {
    response.writeHead(status, { 'content-type': 'text/plain' });
    response.end('ok');
  });
  servers.push(server);
  return server;
}

function scheduler(options: { tickMs?: number } = {}): MonitorScheduler {
  // A long tick interval keeps the automatic loop out of the way; the tests
  // drive `tick()` explicitly.
  const instance = new MonitorScheduler({ tickMs: options.tickMs ?? 60_000 });
  schedulers.push(instance);
  return instance;
}

describe('MonitorScheduler', () => {
  it('executes and records a due check', async () => {
    const userId = await user();
    const server = await mock(200);
    const monitor = await seedMonitor(userId, { url: server.url, name: 'Due now' });

    const instance = scheduler();
    await instance.start();

    expect(await instance.tick()).toBe(1);

    const stored = await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(stored.status).toBe('HEALTHY');
    expect(stored.lastCheckedAt).not.toBeNull();
    expect(await prisma.checkResult.count({ where: { monitorId: monitor.id } })).toBe(1);
    expect(server.requests).toHaveLength(1);
  });

  it('does nothing when no monitor is due', async () => {
    const userId = await user();
    const server = await mock(200);
    await seedMonitor(userId, {
      url: server.url,
      // Comfortably in the future so the scheduler ignores it.
    });
    await prisma.monitor.updateMany({
      where: { userId },
      data: { nextCheckAt: new Date(Date.now() + 3_600_000) },
    });

    const instance = scheduler();
    await instance.start();

    expect(await instance.tick()).toBe(0);
    expect(server.requests).toHaveLength(0);
  });

  it('never checks a disabled monitor', async () => {
    const userId = await user();
    const server = await mock(200);
    await seedMonitor(userId, { url: server.url, enabled: false });

    const instance = scheduler();
    await instance.start();

    expect(await instance.tick()).toBe(0);
    expect(server.requests).toHaveLength(0);
  });

  it('reschedules the monitor after a check, so the next tick leaves it alone', async () => {
    const userId = await user();
    const server = await mock(200);
    await seedMonitor(userId, { url: server.url, intervalSeconds: 300 });

    const instance = scheduler();
    await instance.start();

    expect(await instance.tick()).toBe(1);
    expect(await instance.tick()).toBe(0);
    expect(server.requests).toHaveLength(1);
  });

  it('refuses to dispatch while another instance holds the advisory lock', async () => {
    const userId = await user();
    const server = await mock(200);
    const monitor = await seedMonitor(userId, { url: server.url });

    const leader = scheduler();
    const follower = scheduler();
    await leader.start();
    await follower.start();

    // The follower cannot get the lock, so it must not dispatch anything.
    expect(await follower.tick()).toBe(0);
    expect(server.requests).toHaveLength(0);

    // The leader still works.
    expect(await leader.tick()).toBe(1);
    expect(server.requests).toHaveLength(1);

    const stored = await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(stored.status).toBe('HEALTHY');
  });

  it('hands the lock over when the leader stops', async () => {
    const userId = await user();
    const server = await mock(200);
    await seedMonitor(userId, { url: server.url, intervalSeconds: 300 });

    const leader = scheduler();
    const follower = scheduler();
    await leader.start();
    await follower.start();

    expect(await leader.tick()).toBe(1);
    await leader.stop();

    // Make the monitor due again and confirm the follower can now dispatch.
    await prisma.monitor.updateMany({
      where: { userId },
      data: { nextCheckAt: new Date(Date.now() - 1_000) },
    });

    expect(await follower.tick()).toBe(1);
    expect(server.requests).toHaveLength(2);
  });

  it('ignores re-entrant ticks instead of double-checking a monitor', async () => {
    const userId = await user();
    const server = await mock(200);
    await seedMonitor(userId, { url: server.url, intervalSeconds: 300 });

    const instance = scheduler();
    await instance.start();

    const [first, second] = await Promise.all([instance.tick(), instance.tick()]);
    expect(first + second).toBe(1);
    expect(server.requests).toHaveLength(1);
  });

  it('stops cleanly and can be started again', async () => {
    const instance = scheduler();
    await instance.start();
    await instance.stop();
    await instance.start();
    expect(await instance.tick()).toBe(0);
  });

  it('keeps working when a target fails, recording the failure instead of throwing', async () => {
    const userId = await user();
    const server = await mock(503);
    const monitor = await seedMonitor(userId, { url: server.url });

    const instance = scheduler();
    await instance.start();

    expect(await instance.tick()).toBe(1);

    const stored = await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(stored.status).toBe('DEGRADED');
    expect(stored.consecutiveFailures).toBe(1);
    expect(
      await prisma.incident.count({ where: { monitorId: monitor.id, resolvedAt: null } }),
    ).toBe(1);
  });
});
