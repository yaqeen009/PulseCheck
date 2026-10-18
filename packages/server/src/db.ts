import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';
import { env, isProduction, isTest } from './env.js';
import { logger } from './logger.js';

/**
 * Prisma client with the PostgreSQL driver adapter (Prisma 7).
 *
 * A single instance is shared by the API and the monitoring worker. Pool sizing
 * is explicit: the API handles user traffic, the worker runs checks, and both
 * stay well under a default PostgreSQL `max_connections` of 100.
 */
export function createPrismaClient(connectionString: string = env.DATABASE_URL): PrismaClient {
  const adapter = new PrismaPg({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });

  return new PrismaClient({
    adapter,
    log: isProduction
      ? [{ emit: 'event', level: 'error' }]
      : [
          { emit: 'event', level: 'error' },
          { emit: 'event', level: 'warn' },
        ],
  });
}

export const prisma: PrismaClient = createPrismaClient();

prisma.$on('error' as never, (event: unknown) => {
  logger.error({ event }, 'prisma error');
});
prisma.$on('warn' as never, (event: unknown) => {
  logger.warn({ event }, 'prisma warning');
});

/** Cheap liveness probe for the readiness endpoint. */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    if (!isTest) {
      logger.error({ err: error }, 'database readiness check failed');
    }
    return false;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

export type { PrismaClient };
export { Prisma } from './generated/prisma/client.js';
