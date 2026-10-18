#!/usr/bin/env tsx
/**
 * Local development PostgreSQL manager (embedded-postgres).
 *
 *   npm run db:up      start (and keep running) a local cluster
 *   npm run db:down    stop it
 *   npm run db:status  report whether it is running
 *   npm run db:reset   stop it and delete the data directory
 *
 * Production never uses this script: `DATABASE_URL` points at a managed
 * PostgreSQL instance and migrations run with `npm run db:migrate:deploy`.
 */
import 'dotenv/config';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { startEmbeddedPostgres } from './embedded-pg.js';

const rootDir = path.resolve(import.meta.dirname, '../../..');
const dataDir = path.resolve(rootDir, process.env.EMBEDDED_PG_DIR ?? '.pgdata');
const port = Number(process.env.EMBEDDED_PG_PORT ?? 55432);
const database = process.env.EMBEDDED_PG_DATABASE ?? 'pulsecheck';
const pidFile = path.join(dataDir, 'postmaster.pid');

function readPid(): number | null {
  if (!existsSync(pidFile)) return null;
  try {
    const [pidLine] = readFileSync(pidFile, 'utf8').split('\n');
    const pid = Number(pidLine);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function commandStart(): Promise<void> {
  const existingPid = readPid();
  if (existingPid && isRunning(existingPid)) {
    console.log(`PostgreSQL already running on port ${port} (pid ${existingPid}).`);
    console.log(
      `DATABASE_URL=postgresql://postgres:password@127.0.0.1:${port}/${database}?schema=public`,
    );
    return;
  }

  const handle = await startEmbeddedPostgres({ dataDir, port, database });
  console.log(`PostgreSQL started on port ${port} (data: ${dataDir}).`);
  console.log(
    `DATABASE_URL=postgresql://postgres:password@127.0.0.1:${port}/${database}?schema=public`,
  );
  console.log('Press Ctrl+C to stop.');

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`\nReceived ${signal}, stopping PostgreSQL...`);
    try {
      await handle.stop();
    } catch {
      // Cluster may already be gone.
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  // Keep the event loop alive so the cluster outlives this async function.
  await new Promise<void>(() => {});
}

async function commandStop(): Promise<void> {
  const pid = readPid();
  if (!pid) {
    console.log('PostgreSQL is not running (no postmaster.pid).');
    return;
  }
  if (!isRunning(pid)) {
    console.log('PostgreSQL is not running (stale postmaster.pid).');
    rmSync(pidFile, { force: true });
    return;
  }
  process.kill(pid, 'SIGINT');
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!isRunning(pid)) {
      console.log('PostgreSQL stopped.');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  process.kill(pid, 'SIGKILL');
  console.log('PostgreSQL force-stopped.');
}

async function commandStatus(): Promise<void> {
  const pid = readPid();
  if (pid && isRunning(pid)) {
    console.log(`running  pid=${pid}  port=${port}  data=${dataDir}`);
    return;
  }
  console.log('stopped');
  process.exitCode = 1;
}

async function commandReset(): Promise<void> {
  await commandStop();
  rmSync(dataDir, { recursive: true, force: true });
  console.log(`Deleted ${dataDir}. Run "npm run db:up" then "npm run db:migrate" to recreate.`);
}

const command = process.argv[2] ?? 'start';

const commands: Record<string, () => Promise<void>> = {
  start,
  stop: commandStop,
  status: commandStatus,
  reset: commandReset,
};

async function start(): Promise<void> {
  await commandStart();
}

const run = commands[command];
if (!run) {
  console.error(`Unknown command "${command}". Use one of: ${Object.keys(commands).join(', ')}`);
  process.exit(1);
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
