import { createAuthClient, type ReactBetterAuthClient } from '@neondatabase/auth';
import { BetterAuthReactAdapter } from '@neondatabase/auth/react/adapters';

/**
 * Neon Auth (Managed Better Auth) client.
 *
 * The browser talks to Neon Auth directly for credentials, sessions and the
 * bearer JWT. `createAuthClient` returns the Better Auth client, so `signIn`,
 * `signUp`, `signOut`, `getSession` and `token` are all available here.
 *
 * The base URL must be provided through the `VITE_NEON_AUTH_URL` environment
 * variable (read from the repository-root `.env`). Failing loudly is better than
 * silently talking to the wrong origin.
 */
const authUrl = import.meta.env.VITE_NEON_AUTH_URL;

if (!authUrl) {
  throw new Error(
    'Missing VITE_NEON_AUTH_URL. Set it in the repository-root .env ' +
      '(e.g. the Neon Auth branch URL, https://<host>/<db>/auth) and restart Vite.',
  );
}

export const authClient: ReactBetterAuthClient = createAuthClient(authUrl, {
  adapter: BetterAuthReactAdapter(),
});
