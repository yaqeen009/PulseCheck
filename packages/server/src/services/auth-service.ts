import type { User } from '../generated/prisma/client.js';
import { prisma } from '../db.js';
import { unauthenticated } from '../errors.js';
import { logger } from '../logger.js';
import type { NeonAuthClaims } from '../auth/token-verifier.js';

/**
 * Local user projection for Neon Auth (Managed Better Auth).
 *
 * Neon Auth owns the credential store, so this module keeps no password or
 * session material. The `users` row is a projection keyed by the JWT `sub`, and
 * it exists only so monitors and history can be scoped to an account with a
 * foreign key.
 */

/**
 * Resolve the local user row for a verified token, creating it on first sight.
 *
 * The common case (the row already exists with the same email) is a single
 * read: no write happens on the hot path. The email is refreshed only when the
 * claim has changed. A `P2002` on email means the address already belongs to a
 * different id (the token's subject was reassigned); that is not a usable
 * identity, so it is reported as unauthenticated.
 */
export async function resolveOrCreateUser(claims: NeonAuthClaims): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { id: claims.sub } });

  if (existing) {
    if (existing.email === claims.email) return existing;

    try {
      const updated = await prisma.user.update({
        where: { id: claims.sub },
        data: { email: claims.email },
      });
      logger.info({ userId: updated.id }, 'user email refreshed from token claim');
      return updated;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw unauthenticated('This email is already linked to another account');
      }
      throw error;
    }
  }

  try {
    const created = await prisma.user.create({ data: { id: claims.sub, email: claims.email } });
    logger.info({ userId: created.id }, 'user provisioned from token');
    return created;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      // Concurrent requests from a freshly signed-in client all reach this point
      // at the same time: one insert wins, the rest collide. The id is the
      // identity, so re-read it rather than treating the race as a bad token.
      const raced = await prisma.user.findUnique({ where: { id: claims.sub } });
      if (raced) {
        logger.debug({ userId: raced.id }, 'user row provisioned concurrently by another request');
        return raced;
      }
      throw unauthenticated('This email is already linked to another account');
    }
    throw error;
  }
}

export function isUniqueConstraintError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2002';
}

/** Strip a user row down to the fields that are safe to return. */
export function toPublicUser(user: Pick<User, 'id' | 'email' | 'createdAt'>) {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
  };
}
