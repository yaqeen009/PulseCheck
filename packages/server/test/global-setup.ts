/**
 * Vitest global setup: start an isolated PostgreSQL cluster for the suite and
 * apply the Prisma migrations to it.
 *
 * A separate cluster (port 55433, `.pgdata-test`) is used so the suite can never
 * destroy the development database. The cluster is left running between runs
 * (starting PostgreSQL is slow); stop it with
 * `npm run db:down --prefix packages/server` after pointing EMBEDDED_PG_PORT and
 * EMBEDDED_PG_DIR at the test values, or delete `.pgdata-test`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { startEmbeddedPostgres, type EmbeddedPostgresHandle } from '../scripts/embedded-pg.js';

export const TEST_PG_PORT = 55_433;
export const TEST_PG_DATABASE = 'pulsecheck_test';
export const TEST_DATABASE_URL = `postgresql://postgres:password@127.0.0.1:${TEST_PG_PORT}/${TEST_PG_DATABASE}?schema=public`;

const serverDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(serverDir, '../..');

function readRunningPid(dataDir: string): number | null {
  const pidFile = path.join(dataDir, 'postmaster.pid');
  if (!existsSync(pidFile)) return null;
  try {
    const pid = Number(readFileSync(pidFile, 'utf8').split('\n')[0]);
    if (!Number.isInteger(pid) || pid <= 0) return null;
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

function applyMigrations(): void {
  const prismaBinary = path.resolve(repoRoot, 'node_modules/.bin/prisma');
  execFileSync(prismaBinary, ['migrate', 'deploy'], {
    cwd: serverDir,
    stdio: 'pipe',
    env: {
      ...process.env,
      DATABASE_URL: TEST_DATABASE_URL,
      DIRECT_URL: '',
    },
  });
}

export default async function setup(): Promise<() => Promise<void>> {
  const dataDir = path.resolve(repoRoot, '.pgdata-test');

  // Reuse a cluster left running by a previous run instead of failing on a port
  // conflict, and never stop a cluster this process did not start.
  const alreadyRunning = readRunningPid(dataDir) !== null;

  const handle: EmbeddedPostgresHandle | null = alreadyRunning
    ? null
    : await startEmbeddedPostgres({ dataDir, port: TEST_PG_PORT, database: TEST_PG_DATABASE });

  applyMigrations();

  return async () => {
    if (handle) await handle.stop();
  };
}
