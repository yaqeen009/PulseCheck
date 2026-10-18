import { randomUUID } from 'node:crypto';
import {
  METHODS_WITH_BODY,
  opensIncident,
  resolvesIncident,
  type ErrorCategory,
  type HttpMethod,
  type MonitorStatus,
} from '@pulsecheck/shared';
import type { Monitor } from '../generated/prisma/client.js';
import { prisma } from '../db.js';
import { limits } from '../env.js';
import { logger } from '../logger.js';
import {
  performCheck,
  type CheckConfig,
  type CheckDependencies,
  type CheckOutcome,
} from './checker.js';
import { normalizeHeaders } from '../services/monitor-mapper.js';

/**
 * The monitoring worker.
 *
 * One check for one monitor, executed and persisted atomically:
 *  - the monitor row is locked (`SELECT ... FOR UPDATE`) for the duration of the
 *    write, so two workers can never interleave status or incident updates;
 *  - the check result, the monitor status and the incident bookkeeping are
 *    written in the same transaction, so a crash cannot leave a result without a
 *    matching status change;
 *  - the lease is always released, on every path, so a monitor cannot get stuck.
 */

/** Severity ordering used to decide which status "wins" inside an incident. */
const SEVERITY: Record<MonitorStatus, number> = {
  DOWN: 3,
  DEGRADED: 2,
  PENDING: 1,
  PAUSED: 0,
  HEALTHY: 0,
};

export function monitorToCheckConfig(monitor: Monitor): CheckConfig {
  return {
    url: monitor.url,
    method: monitor.method as HttpMethod,
    headers: normalizeHeaders(monitor.headers),
    body: METHODS_WITH_BODY.includes(monitor.method as HttpMethod) ? monitor.body : null,
    timeoutMs: monitor.timeoutMs,
    expectedStatusMin: monitor.expectedStatusMin,
    expectedStatusMax: monitor.expectedStatusMax,
    degradedResponseTimeMs: monitor.degradedResponseTimeMs,
  };
}

/**
 * When the next check is due.
 *
 * A small random jitter (0-10% of the interval) spreads monitors that share a
 * schedule, so a fleet of 60-second monitors does not stampede the database or
 * the targets at each minute boundary.
 */
export function computeNextCheckAt(
  completedAt: Date,
  intervalSeconds: number,
  random = Math.random,
): Date {
  const jitterMs = Math.floor(intervalSeconds * 1_000 * 0.1 * random());
  return new Date(completedAt.getTime() + intervalSeconds * 1_000 + jitterMs);
}

/**
 * Atomically claim a due monitor.
 *
 * Only one worker can win: the `updateMany` matches on `leaseToken IS NULL OR
 * leaseExpiresAt < now`, and PostgreSQL applies it atomically. An expired lease is
 * reclaimable, so a crashed worker cannot permanently stall a monitor.
 */
export async function claimMonitor(
  monitorId: string,
  leaseMs: number,
  token: string,
): Promise<boolean> {
  const now = new Date();
  const result = await prisma.monitor.updateMany({
    where: {
      id: monitorId,
      enabled: true,
      nextCheckAt: { lte: now },
      OR: [{ leaseToken: null }, { leaseExpiresAt: { lt: now } }],
    },
    data: {
      leaseToken: token.slice(0, 36),
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
    },
  });
  return result.count === 1;
}

export interface RecordedCheck extends CheckOutcome {
  monitorId: string;
  checkedAt: Date;
  completedAt: Date;
  previousStatus: MonitorStatus;
  incidentOpened: boolean;
  incidentResolved: boolean;
}

/**
 * Run a check and persist the result, the derived status and incident changes.
 */
export async function executeAndRecordCheck(
  monitor: Monitor,
  dependencies: CheckDependencies = {},
): Promise<RecordedCheck> {
  const checkedAt = new Date();
  const outcome = await performCheck(monitorToCheckConfig(monitor), dependencies);
  const completedAt = new Date();

  const recorded = await prisma.$transaction(async (tx) => {
    // Serialise all writes for this monitor.
    await tx.$queryRaw`SELECT id FROM monitors WHERE id = ${monitor.id}::uuid FOR UPDATE`;

    const current = await tx.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    const previousStatus = current.status as MonitorStatus;

    await tx.checkResult.create({
      data: {
        monitorId: monitor.id,
        checkedAt,
        completedAt,
        success: outcome.success,
        httpStatusCode: outcome.httpStatusCode,
        responseTimeMs: outcome.responseTimeMs,
        errorCategory: (outcome.errorCategory as ErrorCategory | null) ?? null,
        errorMessage: outcome.errorMessage,
      },
    });

    // A monitor paused while its check was in flight stays paused; the result is
    // still recorded because it describes a request that really happened.
    const nextStatus: MonitorStatus = current.enabled ? outcome.status : 'PAUSED';
    const statusChanged = nextStatus !== previousStatus;
    const openIncident = await tx.incident.findFirst({
      where: { monitorId: monitor.id, resolvedAt: null },
      orderBy: { startedAt: 'desc' },
    });

    let incidentOpened = false;
    let incidentResolved = false;

    if (current.enabled && (nextStatus === 'DOWN' || nextStatus === 'DEGRADED')) {
      if (opensIncident(previousStatus, nextStatus)) {
        await tx.incident.create({
          data: {
            monitorId: monitor.id,
            startedAt: checkedAt,
            initialStatus: nextStatus,
            peakStatus: nextStatus,
            latestErrorSummary: outcome.errorMessage,
            failedCheckCount: 1,
          },
        });
        incidentOpened = true;
      } else if (openIncident) {
        // Same outage: accumulate instead of opening a second incident.
        const peakStatus =
          SEVERITY[nextStatus] > SEVERITY[openIncident.peakStatus as MonitorStatus]
            ? nextStatus
            : (openIncident.peakStatus as MonitorStatus);
        await tx.incident.update({
          where: { id: openIncident.id },
          data: {
            failedCheckCount: { increment: 1 },
            peakStatus,
            latestErrorSummary: outcome.errorMessage ?? openIncident.latestErrorSummary,
          },
        });
      }
    } else if (current.enabled && openIncident && resolvesIncident(previousStatus, nextStatus)) {
      await tx.incident.update({
        where: { id: openIncident.id },
        data: { resolvedAt: checkedAt },
      });
      incidentResolved = true;
    }

    await tx.monitor.update({
      where: { id: monitor.id },
      data: {
        status: nextStatus,
        lastCheckedAt: checkedAt,
        consecutiveFailures: outcome.success ? 0 : { increment: 1 },
        nextCheckAt: current.enabled
          ? computeNextCheckAt(completedAt, current.intervalSeconds)
          : current.nextCheckAt,
        ...(statusChanged ? { lastStatusChangeAt: checkedAt } : {}),
        // Always release the lease, whatever happened above.
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });

    return {
      ...outcome,
      monitorId: monitor.id,
      checkedAt,
      completedAt,
      previousStatus,
      incidentOpened,
      incidentResolved,
    };
  });

  if (recorded.incidentOpened || recorded.incidentResolved) {
    logger.info(
      {
        monitorId: monitor.id,
        previousStatus: recorded.previousStatus,
        status: recorded.status,
        incidentOpened: recorded.incidentOpened,
        incidentResolved: recorded.incidentResolved,
      },
      'monitor status changed',
    );
  }

  return recorded;
}

/** Claim, check and record. Returns false when another worker holds the lease. */
export async function runCheckForMonitor(
  monitorId: string,
  dependencies: CheckDependencies = {},
): Promise<RecordedCheck | null> {
  const monitor = await prisma.monitor.findUnique({ where: { id: monitorId } });
  if (!monitor || !monitor.enabled) return null;

  const token = randomUUID();
  const leaseMs = Math.max(
    limits.checkLeaseMs,
    monitor.timeoutMs * limits.leaseTimeoutFactor + 5_000,
  );
  const claimed = await claimMonitor(monitorId, leaseMs, token);
  if (!claimed) return null;

  try {
    return await executeAndRecordCheck(monitor, dependencies);
  } finally {
    // Belt and braces: the transaction normally clears the lease already.
    await prisma.monitor
      .updateMany({
        where: { id: monitorId, leaseToken: token.slice(0, 36) },
        data: { leaseToken: null, leaseExpiresAt: null },
      })
      .catch(() => undefined);
  }
}

/**
 * Retention: delete check results older than the configured window in bounded
 * batches. Incidents are kept indefinitely (they are tiny and are the audit
 * trail of an outage).
 */
export async function pruneOldCheckResults(
  retentionDays: number = limits.defaultRetentionDays,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1_000);
  let deleted = 0;

  for (let round = 0; round < 20; round += 1) {
    const batch = await prisma.$executeRaw`
      DELETE FROM check_results
      WHERE id IN (
        SELECT id FROM check_results WHERE checked_at < ${cutoff} LIMIT 5000
      )
    `;
    deleted += batch;
    if (batch < 5000) break;
  }

  if (deleted > 0) {
    logger.info({ deleted, retentionDays }, 'pruned check history');
  }
  return deleted;
}
