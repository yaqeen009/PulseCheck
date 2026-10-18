import { generateKeyPair, SignJWT, jwtVerify, type CryptoKey } from 'jose';
import type { NeonAuthClaims, TokenVerifier } from '../../src/auth/token-verifier.js';

/**
 * Test-only JWT helpers.
 *
 * The suite must run with no network access, so tokens are signed locally with a
 * throwaway Ed25519 keypair and verified by an injected verifier. The shape of
 * the tokens matches Neon Auth (`alg: EdDSA`, `iss`/`aud` equal to the auth
 * origin, `sub`/`email` claims), but nothing leaves the process.
 */

const ISSUER = 'https://test-neon-auth.local';

// One keypair per process: module evaluation happens once per worker.
const primary = await generateKeyPair('EdDSA');
// A second, unrelated keypair, used to prove a token signed by the wrong key is
// rejected.
const secondary = await generateKeyPair('EdDSA');

export const testSigningKey: CryptoKey = primary.privateKey;
export const testVerifyKey: CryptoKey = primary.publicKey;

export const wrongSigningKey: CryptoKey = secondary.privateKey;
export const wrongVerifyKey: CryptoKey = secondary.publicKey;

export interface TestTokenClaims {
  sub?: string;
  email?: string;
  name?: string;
}

export interface TestTokenOptions {
  /** `setExpirationTime` value, e.g. `'15m'` or `'-1s'`. Defaults to `'15m'`. */
  expiresIn?: string;
  issuer?: string;
  audience?: string;
  /** Sign with a different key to produce an untrusted token. */
  key?: CryptoKey;
}

/** Sign a token locally. Claims that are omitted are simply absent from the JWT. */
export async function signTestToken(
  claims: TestTokenClaims,
  options: TestTokenOptions = {},
): Promise<string> {
  const payload: Record<string, unknown> = {};
  if (claims.sub !== undefined) payload.sub = claims.sub;
  if (claims.email !== undefined) payload.email = claims.email;
  if (claims.name !== undefined) payload.name = claims.name;

  const issuer = options.issuer ?? ISSUER;

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(options.audience ?? issuer)
    .setExpirationTime(options.expiresIn ?? '15m')
    .sign(options.key ?? testSigningKey);
}

/**
 * A verifier with the same contract as the production one, backed by the local
 * public key. It enforces the same `sub`/`email` requirement so behaviour under
 * test matches the real middleware.
 */
export const testVerifier: TokenVerifier = {
  async verify(token: string): Promise<NeonAuthClaims> {
    const { payload } = await jwtVerify(token, testVerifyKey, { algorithms: ['EdDSA'] });

    const sub = payload.sub;
    const email = payload.email;
    if (typeof sub !== 'string' || sub.trim() === '') {
      throw new Error('token is missing a usable "sub" claim');
    }
    if (typeof email !== 'string' || email.trim() === '') {
      throw new Error('token is missing a usable "email" claim');
    }

    return { sub, email };
  },
};
