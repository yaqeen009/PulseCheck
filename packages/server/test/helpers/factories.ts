import { randomBytes, randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { ErrorCategory, HttpMethod, MonitorStatus, UserDto } from '@pulsecheck/shared';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import type { TokenVerifier } from '../../src/auth/token-verifier.js';
import { TestClient } from './client.js';
import { signTestToken, testVerifier } from './jwt.js';

export function uniqueEmail(prefix = 'test'): string {
  return `${prefix}-${randomUUID()}@example.com`;
}

/** A fresh app, a bearer-token client, and the verifier the app trusts. */
export function createTestContext(): {
  app: Express;
  client: TestClient;
  verifier: TokenVerifier;
} {
  const app = createApp({ quiet: true, tokenVerifier: testVerifier });
  return { app, client: new TestClient(app), verifier: testVerifier };
}

/**
 * Create the local user row directly. The id is the Neon Auth subject, so a
 * token signed with this `sub` resolves to this row.
 */
export async function createUser(email = uniqueEmail()): Promise<UserDto> {
  const user = await prisma.user.create({ data: { id: randomUUID(), email } });
  return { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() };
}

/**
 * Convenience for API tests: create the user row, sign a token for it and
 * attach it to the client. Returns the public user.
 */
export async function signUp(client: TestClient, email = uniqueEmail()): Promise<UserDto> {
  const user = await createUser(email);
  const token = await signTestToken({ sub: user.id, email: user.email });
  client.setToken(token);
  return user;
}

export interface MonitorSeed {
  name?: string;
  url?: string;
  method?: HttpMethod;
  intervalSeconds?: number;
  timeoutMs?: number;
  expectedStatusMin?: number;
  expectedStatusMax?: number;
  headers?: Record<string, string>;
  body?: string | null;
  degradedResponseTimeMs?: number | null;
  enabled?: boolean;
  status?: MonitorStatus;
}

/** Insert a monitor row directly, for the worker and stats tests. */
export async function seedMonitor(userId: string, seed: MonitorSeed = {}) {
  return prisma.monitor.create({
    data: {
      userId,
      name: seed.name ?? `monitor-${randomBytes(3).toString('hex')}`,
      url: seed.url ?? 'http://127.0.0.1:9/health',
      method: seed.method ?? 'GET',
      intervalSeconds: seed.intervalSeconds ?? 60,
      timeoutMs: seed.timeoutMs ?? 2_000,
      expectedStatusMin: seed.expectedStatusMin ?? 200,
      expectedStatusMax: seed.expectedStatusMax ?? 299,
      headers: seed.headers ?? {},
      body: seed.body ?? null,
      degradedResponseTimeMs: seed.degradedResponseTimeMs ?? null,
      enabled: seed.enabled ?? true,
      status: seed.status ?? 'PENDING',
      nextCheckAt: new Date(),
    },
  });
}

export interface CheckResultSeed {
  checkedAt?: Date;
  success?: boolean;
  httpStatusCode?: number | null;
  responseTimeMs?: number;
  errorCategory?: ErrorCategory | null;
  errorMessage?: string | null;
}

/** Insert check results directly, for the stats tests. */
export async function seedCheckResults(monitorId: string, results: CheckResultSeed[]) {
  for (const result of results) {
    const checkedAt = result.checkedAt ?? new Date();
    await prisma.checkResult.create({
      data: {
        monitorId,
        checkedAt,
        completedAt: new Date(checkedAt.getTime() + (result.responseTimeMs ?? 10)),
        success: result.success ?? true,
        httpStatusCode: result.httpStatusCode === undefined ? 200 : result.httpStatusCode,
        responseTimeMs: result.responseTimeMs ?? 10,
        errorCategory: result.errorCategory ?? null,
        errorMessage: result.errorMessage ?? null,
      },
    });
  }
}

/** Remove everything a test created, in dependency order. */
export async function cleanupUser(userId: string): Promise<void> {
  await prisma.incident.deleteMany({ where: { monitor: { userId } } });
  await prisma.checkResult.deleteMany({ where: { monitor: { userId } } });
  await prisma.monitor.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}
