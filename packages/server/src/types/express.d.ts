import type { Logger } from 'pino';
import type { Monitor, User } from '../generated/prisma/client.js';

/**
 * Authenticated request context attached by the auth middleware.
 * There is no session row: identity is carried by the verified bearer token and
 * projected onto the local user.
 */
export interface AuthContext {
  user: Pick<User, 'id' | 'email' | 'createdAt'>;
}

declare global {
  namespace Express {
    interface Request {
      /** Correlation id, echoed in the `X-Request-Id` response header. */
      requestId: string;
      /** Request-scoped logger carrying the correlation id. */
      log: Logger;
      /** Present only after `requireAuth` succeeded. */
      auth?: AuthContext;
      /** Set by the ownership middleware once a monitor is verified. */
      monitor?: Monitor;
    }
  }
}

export {};
