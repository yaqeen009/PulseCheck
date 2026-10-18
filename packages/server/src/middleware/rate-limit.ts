import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { env, isTest } from '../env.js';

/**
 * Per-IP ceiling for the API.
 *
 * Authentication itself is owned by Neon Auth, so there is no credential
 * endpoint in this service to rate limit separately; the API bucket below is
 * the only limiter.
 *
 * It keys on the client IP. Behind a proxy, set `TRUST_PROXY=true` so Express
 * resolves the real client address, and terminate TLS at that proxy.
 */
function keyGenerator(request: Request): string {
  return request.ip ?? request.socket.remoteAddress ?? 'unknown';
}

function rateLimitHandler(code: string, message: string) {
  return (_request: Request, response: Response): void => {
    response.status(429).json({ error: { code, message } });
  };
}

export const apiLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: env.RATE_LIMIT_API_WINDOW_MINUTES * 60 * 1_000,
  limit: isTest ? 100_000 : env.RATE_LIMIT_API_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator,
  handler: rateLimitHandler('RATE_LIMITED', 'Too many requests. Try again later.'),
});
