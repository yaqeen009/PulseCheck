import { Client } from 'pg';
import { prisma } from '../db.js';
import { env, limits } from '../env.js';
import { logger } from '../logger.js';
import { claimMonitor, executeAndRecordCheck, pruneOldCheckResults } from './worker.js';
import { randomUUID } from 'node:crypto';
import type { Dispatcher } from 'undici';

/**
 * The scheduler.
 *
 * Deployment model (documented in docs/ARCHITECTURE.md):
 *
 *  - The scheduler is lease-based, not in-memory-only. Two safety layers make
 *    duplicate execution impossible:
 *      1. A PostgreSQL *advisory lock* (`pg_try_advisory_lock`) guarantees that
 *         only one process in the fleet runs the scheduling loop. The lock is
 *         held on a dedicated connection and released on shutdown, so a
 *         replacement takes over automatically.
 *      2. Every individual check claims a *row lease* on the monitor
 *         (`claimMonitor`), so even if two schedulers ever ran, only one could
 *         execute a given due check.
 *  - Ticks never overlap within a process: the loop awaits the current batch
 *    before starting the next one.
 *  - A batch is processed with a fixed concurrency ceiling, so a fleet of
 *    expiring monitors cannot open unbounded sockets.
 *  - Jitter on `nextCheckAt` (see the worker) spreads due times.
 *
 * This is the "safe single-scheduler, N workers" model. Horizontal scaling of
 * the API is fine: every instance connects to the same database, exactly one
 * holds the advisory lock, and the row leases protect the checks.
 */

/** 0x50554c53 == "PULS". Arbitrary but stable across releases. */
const ADVISORY_LOCK_KEY = 1_347_375_955;

export interface SchedulerOptions {
  tickMs?: number;
  batchSize?: number;
  concurrency?: number;
  dispatcher?: Dispatcher;
  /** Retention window for check history. */
  retentionDays?: number;
}

export class MonitorScheduler {
  private readonly tickMs: number;
  private readonly batchSize: number;
  private readonly concurrency: number;
  private readonly retentionDays: number;
  private readonly dispatcher: Dispatcher | undefined;

  private timer: NodeJS.Timeout | undefined;
  private lockClient: Client | undefined;
  private holdsLock = false;
  private ticking = false;
  private stopped = false;
  private lastPruneAt = 0;
  private inFlight = 0;

  constructor(options: SchedulerOptions = {}) {
    this.tickMs = options.tickMs ?? limits.schedulerTickMs;
    // Keep a tick comfortably under the shortest supported interval.
    this.batchSize = options.batchSize ?? Math.max(20, limits.checkConcurrency * 5);
    this.concurrency = options.concurrency ?? limits.checkConcurrency;
    this.retentionDays = options.retentionDays ?? limits.defaultRetentionDays;
    this.dispatcher = options.dispatcher;
  }

  async start(): Promise<void> {
    if (this.timer) return;
    this.stopped = false;
    await this.tryAcquireLock();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickMs);
    // Do not hold the process open just for the scheduler.
    this.timer.unref?.();
    logger.info(
      { tickMs: this.tickMs, concurrency: this.concurrency },
      'monitor scheduler started',
    );
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    // Wait briefly for in-flight checks so a shutdown cannot lose a result.
    const deadline = Date.now() + 15_000;
    while (this.inFlight > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await this.releaseLock();
    logger.info('monitor scheduler stopped');
  }

  /** Exposed for tests and for a manual "run one tick" operation. */
  async tick(): Promise<number> {
    if (this.ticking || this.stopped) return 0;
    if (!this.holdsLock) {
      const acquired = await this.tryAcquireLock();
      if (!acquired) return 0;
    }

    this.ticking = true;
    let executed = 0;

    try {
      const now = new Date();
      const due = await prisma.monitor.findMany({
        where: {
          enabled: true,
          nextCheckAt: { lte: now },
          OR: [{ leaseToken: null }, { leaseExpiresAt: { lt: now } }],
        },
        orderBy: { nextCheckAt: 'asc' },
        take: this.batchSize,
      });

      if (due.length > 0) {
        await this.processBatch(due);
        executed = due.length;
      }

      await this.maybePrune();
    } catch (error) {
      logger.error({ err: error }, 'scheduler tick failed');
    } finally {
      this.ticking = false;
    }

    return executed;
  }

  private async processBatch(monitors: { id: string; timeoutMs: number }[]): Promise<void> {
    const queue = [...monitors];

    const runners = Array.from({ length: Math.min(this.concurrency, queue.length) }, async () => {
      for (;;) {
        const monitor = queue.shift();
        if (!monitor || this.stopped) return;

        const token = randomUUID();
        const leaseMs = Math.max(
          limits.checkLeaseMs,
          monitor.timeoutMs * limits.leaseTimeoutFactor + 5_000,
        );

        let claimed = false;
        try {
          claimed = await claimMonitor(monitor.id, leaseMs, token);
        } catch (error) {
          logger.error({ err: error, monitorId: monitor.id }, 'failed to claim monitor');
          continue;
        }
        if (!claimed) continue;

        this.inFlight += 1;
        try {
          const current = await prisma.monitor.findUnique({ where: { id: monitor.id } });
          if (!current) continue;

          const result = await executeAndRecordCheck(
            current,
            this.dispatcher ? { dispatcher: this.dispatcher } : {},
          );

          logger.debug(
            {
              monitorId: monitor.id,
              status: result.status,
              responseTimeMs: result.responseTimeMs,
              httpStatusCode: result.httpStatusCode,
            },
            'check recorded',
          );
        } catch (error) {
          logger.error({ err: error, monitorId: monitor.id }, 'check failed unexpectedly');
        } finally {
          this.inFlight -= 1;
          // executeAndRecordCheck clears the lease; this covers the paths where it
          // could not run at all (for example the monitor was deleted mid-flight).
          await prisma.monitor
            .updateMany({
              where: { id: monitor.id, leaseToken: token },
              data: { leaseToken: null, leaseExpiresAt: null },
            })
            .catch(() => undefined);
        }
      }
    });

    await Promise.all(runners);
  }

  private async tryAcquireLock(): Promise<boolean> {
    if (this.holdsLock) return true;

    try {
      const client = new Client({ connectionString: env.DATABASE_URL });
      await client.connect();
      const result = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [ADVISORY_LOCK_KEY],
      );

      if (result.rows[0]?.locked) {
        this.lockClient = client;
        this.holdsLock = true;
        return true;
      }

      await client.end().catch(() => undefined);
      logger.warn(
        'another PulseCheck scheduler holds the advisory lock; this instance will not dispatch checks',
      );
      return false;
    } catch (error) {
      logger.error({ err: error }, 'could not acquire the scheduler advisory lock');
      return false;
    }
  }

  private async releaseLock(): Promise<void> {
    if (!this.lockClient) return;
    try {
      await this.lockClient.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    } catch {
      // The connection may already be gone; the lock is released with the session.
    }
    await this.lockClient.end().catch(() => undefined);
    this.lockClient = undefined;
    this.holdsLock = false;
  }

  private async maybePrune(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPruneAt < 60 * 60 * 1_000) return;
    this.lastPruneAt = now;
    try {
      await pruneOldCheckResults(this.retentionDays);
    } catch (error) {
      logger.error({ err: error }, 'retention pruning failed');
    }
  }
}
