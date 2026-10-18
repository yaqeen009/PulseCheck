import type { NextFunction, Request, Response } from 'express';
import { isAppError, unauthenticated } from '../errors.js';
import { isUniqueConstraintError, resolveOrCreateUser } from '../services/auth-service.js';
import type { TokenVerifier } from '../auth/token-verifier.js';

/** Extract the token from an `Authorization: Bearer <token>` header, if any. */
function readBearerToken(request: Request): string | null {
  const header = request.header('authorization');
  if (!header) return null;

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token ? token : null;
}

/**
 * Build the auth middleware for a given token verifier.
 *
 * A browser cannot be tricked into attaching a bearer header to a cross-site
 * request, so CSRF protection does not apply: there is no ambient credential
 * for an attacker to ride. Cookies, session rows and CSRF tokens are gone.
 *
 * The middleware is deliberately forgiving: a missing or invalid token simply
 * leaves `request.auth` unset and lets the route decide. Only `requireAuth`
 * turns that into a 401. Verification failures are never surfaced as 500.
 */
export function createAttachAuth(verifier: TokenVerifier) {
  return async function attachAuth(
    request: Request,
    _response: Response,
    next: NextFunction,
  ): Promise<void> {
    const token = readBearerToken(request);
    if (!token) {
      next();
      return;
    }

    let claims: Awaited<ReturnType<TokenVerifier['verify']>>;
    try {
      claims = await verifier.verify(token);
    } catch (error) {
      request.log?.debug({ err: error }, 'bearer token rejected');
      next();
      return;
    }

    try {
      const user = await resolveOrCreateUser(claims);
      request.auth = {
        user: { id: user.id, email: user.email, createdAt: user.createdAt },
      };
    } catch (error) {
      // A duplicate-email conflict means the token cannot be mapped to a local
      // account; anything else is a real fault and goes to the error handler.
      if (isAppError(error) || isUniqueConstraintError(error)) {
        next(unauthenticated());
        return;
      }
      request.log?.error({ err: error }, 'failed to resolve local user for token');
      next(error);
      return;
    }

    next();
  };
}

export function requireAuth(request: Request, _response: Response, next: NextFunction): void {
  if (!request.auth) {
    next(unauthenticated());
    return;
  }
  next();
}
