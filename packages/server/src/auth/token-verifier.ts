import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { neonAuthIssuer, neonAuthJwksUrl } from '../env.js';
import { logger } from '../logger.js';

/** The claims this API relies on. Everything else in the token is ignored. */
export interface NeonAuthClaims {
  sub: string;
  email: string;
}

/** Verify a bearer token, or throw. The caller maps any throw to 401. */
export interface TokenVerifier {
  verify(token: string): Promise<NeonAuthClaims>;
}

/**
 * Lazily created JWKS set, shared process-wide.
 *
 * `createRemoteJWKSet` caches fetched keys (and their `kid`s) internally, so
 * verification is a local signature check after the first fetch. Building it
 * lazily keeps the module import side-effect free for tests.
 */
function createJwksSet(jwksUrl: string) {
  return createRemoteJWKSet(new URL(jwksUrl));
}

/**
 * Build a verifier for Neon Auth (Managed Better Auth) access tokens.
 *
 * Neon Auth signs access tokens with Ed25519 (`alg: EdDSA`), sets `iss` and
 * `aud` to the origin of the auth base URL, and exposes the public keys at
 * `/.well-known/jwks.json`. Only that single algorithm is accepted, so a token
 * that tries to downgrade the algorithm is rejected outright.
 */
export function createNeonAuthVerifier(config?: {
  issuer?: string;
  jwksUrl?: string;
}): TokenVerifier {
  const issuer = config?.issuer ?? neonAuthIssuer;
  const jwksUrl = config?.jwksUrl ?? neonAuthJwksUrl;
  const jwks = createJwksSet(jwksUrl);

  return {
    async verify(token: string): Promise<NeonAuthClaims> {
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: issuer,
        algorithms: ['EdDSA'],
      });

      const claims = requireClaims(payload);
      return claims;
    },
  };
}

/**
 * Validate the two claims the local user projection depends on. A token with a
 * missing or non-string `sub`/`email` cannot be mapped to a user row, so it is
 * treated as invalid (the caller answers 401).
 */
function requireClaims(payload: JWTPayload): NeonAuthClaims {
  const sub = payload.sub;
  const email = payload.email;

  if (typeof sub !== 'string' || sub.trim() === '') {
    throw new Error('token is missing a usable "sub" claim');
  }
  if (typeof email !== 'string' || email.trim() === '') {
    throw new Error('token is missing a usable "email" claim');
  }

  return { sub, email };
}

/** Module-level lazy singleton, so the key cache is shared across requests. */
let defaultVerifier: TokenVerifier | undefined;

/** The process-wide Neon Auth verifier, created on first use. */
export function getDefaultTokenVerifier(): TokenVerifier {
  if (!defaultVerifier) {
    defaultVerifier = createNeonAuthVerifier();
    logger.debug({ issuer: neonAuthIssuer, jwksUrl: neonAuthJwksUrl }, 'token verifier ready');
  }
  return defaultVerifier;
}
