import type { Monitor, Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db.js';
import { limits } from '../env.js';
import { conflict, limitExceeded, notFound } from '../errors.js';
import {
  validateMergedMonitorConfig,
  type MonitorConfigInput,
  type MonitorCreateInput,
  type MonitorUpdateInput,
} from './monitor-config.js';
import { normalizeHeaders } from './monitor-mapper.js';
import { STATUS_AFTER_RESUME } from '@pulsecheck/shared';
import type { MonitorListQuery } from '../validation.js';

/**
 * Monitor CRUD.
 *
 * Ownership is enforced on every read and write by filtering on `userId` in the
 * query itself, so a monitor belonging to another account is indistinguishable
 * from a monitor that does not exist (404, never 403).
 */

const ORDER_BY: Record<MonitorListQuery['sort'], keyof Prisma.MonitorOrderByWithRelationInput> = {
  name: 'name',
  status: 'status',
  lastCheckedAt: 'lastCheckedAt',
  createdAt: 'createdAt',
};

export async function countMonitors(userId: string): Promise<number> {
  return prisma.monitor.count({ where: { userId } });
}

export async function listMonitors(userId: string, query: MonitorListQuery): Promise<Monitor[]> {
  const where: Prisma.MonitorWhereInput = { userId };

  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { url: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  if (query.status && query.status !== 'ALL') {
    where.status = query.status;
  }

  return prisma.monitor.findMany({
    where,
    orderBy: { [ORDER_BY[query.sort]]: query.order },
    // Bounded by MAX_MONITORS_PER_USER; the list view never paginates beyond that.
    take: limits.maxMonitorsPerUser * 2,
  });
}

export async function getMonitorOrThrow(userId: string, monitorId: string): Promise<Monitor> {
  const monitor = await prisma.monitor.findFirst({ where: { id: monitorId, userId } });
  if (!monitor) throw notFound('Monitor not found');
  return monitor;
}

export async function createMonitor(userId: string, input: MonitorCreateInput): Promise<Monitor> {
  const existingCount = await countMonitors(userId);
  if (existingCount >= limits.maxMonitorsPerUser) {
    throw limitExceeded(
      `Monitor limit reached. This account can hold at most ${limits.maxMonitorsPerUser} monitors.`,
    );
  }

  return prisma.monitor.create({
    data: {
      userId,
      name: input.name,
      url: input.url,
      method: input.method,
      intervalSeconds: input.intervalSeconds,
      timeoutMs: input.timeoutMs,
      expectedStatusMin: input.expectedStatusMin,
      expectedStatusMax: input.expectedStatusMax,
      headers: input.headers,
      body: input.body,
      degradedResponseTimeMs: input.degradedResponseTimeMs,
      enabled: input.enabled,
      // A brand-new monitor has no completed check unless it is paused.
      status: input.enabled ? 'PENDING' : 'PAUSED',
      nextCheckAt: new Date(),
    },
  });
}

export async function updateMonitor(
  userId: string,
  monitorId: string,
  patch: MonitorUpdateInput,
): Promise<Monitor> {
  const existing = await getMonitorOrThrow(userId, monitorId);

  const merged: MonitorConfigInput = {
    name: patch.name ?? existing.name,
    url: patch.url ?? existing.url,
    method: patch.method ?? existing.method,
    intervalSeconds: patch.intervalSeconds ?? existing.intervalSeconds,
    timeoutMs: patch.timeoutMs ?? existing.timeoutMs,
    expectedStatusMin: patch.expectedStatusMin ?? existing.expectedStatusMin,
    expectedStatusMax: patch.expectedStatusMax ?? existing.expectedStatusMax,
    headers: patch.headers ?? normalizeHeaders(existing.headers),
    body: patch.body === undefined ? existing.body : patch.body,
    degradedResponseTimeMs:
      patch.degradedResponseTimeMs === undefined
        ? existing.degradedResponseTimeMs
        : patch.degradedResponseTimeMs,
  };

  const problems = validateMergedMonitorConfig(merged, limits);
  if (problems.length > 0) {
    throw conflict(problems.join('; '));
  }

  const enabled = patch.enabled ?? existing.enabled;
  const justEnabled = enabled && !existing.enabled;
  const resultChanged =
    merged.url !== existing.url ||
    merged.method !== existing.method ||
    JSON.stringify(merged.headers) !== JSON.stringify(normalizeHeaders(existing.headers)) ||
    merged.body !== existing.body;

  return prisma.monitor.update({
    where: { id: monitorId },
    data: {
      ...merged,
      enabled,
      // Re-enabling restarts monitoring immediately; a changed target is checked
      // straight away rather than after the old interval elapses.
      ...(justEnabled ? { status: STATUS_AFTER_RESUME, nextCheckAt: new Date() } : {}),
      ...(!justEnabled && enabled && resultChanged ? { nextCheckAt: new Date() } : {}),
      ...(!enabled ? { status: 'PAUSED' } : {}),
    },
  });
}

export async function pauseMonitor(userId: string, monitorId: string): Promise<Monitor> {
  const existing = await getMonitorOrThrow(userId, monitorId);
  if (!existing.enabled) return existing;

  const now = new Date();

  // Pausing is an operator intervention: it ends any open incident window rather
  // than leaving an incident open forever for a monitor nobody is checking.
  return prisma.$transaction(async (tx) => {
    await tx.incident.updateMany({
      where: { monitorId, resolvedAt: null },
      data: { resolvedAt: now, latestErrorSummary: 'Monitoring paused by the account owner' },
    });

    return tx.monitor.update({
      where: { id: monitorId },
      data: {
        enabled: false,
        status: 'PAUSED',
        lastStatusChangeAt: now,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
  });
}

export async function resumeMonitor(userId: string, monitorId: string): Promise<Monitor> {
  const existing = await getMonitorOrThrow(userId, monitorId);
  if (existing.enabled) return existing;

  return prisma.monitor.update({
    where: { id: monitorId },
    data: {
      enabled: true,
      status: STATUS_AFTER_RESUME,
      lastStatusChangeAt: new Date(),
      nextCheckAt: new Date(),
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
}

export async function deleteMonitor(userId: string, monitorId: string): Promise<void> {
  await getMonitorOrThrow(userId, monitorId);
  // Check results and incidents cascade via the schema's onDelete: Cascade.
  await prisma.monitor.delete({ where: { id: monitorId } });
}
