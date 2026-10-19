import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { API_PREFIX } from '@pulsecheck/shared';
import { allowedOrigins, assertProductionWebOrigin, env, isTest } from './env.js';
import { logger } from './logger.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { asyncHandler, errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { apiLimiter } from './middleware/rate-limit.js';
import { createAttachAuth } from './middleware/auth.js';
import { getDefaultTokenVerifier, type TokenVerifier } from './auth/token-verifier.js';
import { authRouter } from './routes/auth.js';
import { monitorsRouter } from './routes/monitors.js';
import { incidentsRouter, monitorHistoryRouter } from './routes/history.js';
import { dashboardRouter } from './routes/dashboard.js';
import { healthRouter } from './routes/health.js';
import { metaRouter } from './routes/meta.js';

export interface CreateAppOptions {
  /** Disable the HTTP logger (used by tests to keep output readable). */
  quiet?: boolean;
  /** Token verifier to use. Defaults to the process-wide Neon Auth verifier. */
  tokenVerifier?: TokenVerifier;
}

/**
 * Build the Express application.
 *
 * Middleware order is deliberate:
 *   request id -> structured logging -> security headers -> CORS -> body parsing
 *   -> rate limiting -> bearer-token resolution -> routes -> errors.
 * CSRF protection is not applicable: the API is bearer-token only, so no
 * ambient cookie credential exists for a cross-site request to abuse.
 */
export function createApp(options: CreateAppOptions = {}): Express {
  // Fail fast on a production deploy that still points CORS at localhost.
  assertProductionWebOrigin();

  const app = express();

  app.disable('x-powered-by');
  if (env.TRUST_PROXY) app.set('trust proxy', 1);

  app.use(requestIdMiddleware);

  if (!options.quiet && !isTest) {
    app.use(
      pinoHttp({
        logger,
        genReqId: (request) => (request as express.Request).requestId,
        autoLogging: {
          ignore: (request) => request.url === '/health/live' || request.url === '/health/ready',
        },
        customLogLevel: (_request, response, error) => {
          if (error || response.statusCode >= 500) return 'error';
          if (response.statusCode >= 400) return 'warn';
          return 'info';
        },
      }),
    );
  }

  // The API returns JSON only; a strict CSP and no framing is appropriate.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['content-type', 'authorization', 'x-request-id'],
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: '100kb' }));

  // Health endpoints stay outside the versioned API and are never rate limited
  // by the API bucket, so orchestration probes cannot be throttled.
  app.use('/health', healthRouter);

  const tokenVerifier = options.tokenVerifier ?? getDefaultTokenVerifier();

  const api = express.Router();
  api.use(apiLimiter);
  api.use(createAttachAuth(tokenVerifier));

  // API responses carry per-user data and must never be cached by a browser or
  // an intermediary. `no-store` keeps authenticated responses out of shared
  // caches and private data out of browser history.
  api.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });

  api.use('/auth', authRouter);
  api.use('/monitors', monitorsRouter);
  api.use('/monitors/:id', monitorHistoryRouter);
  api.use('/incidents', incidentsRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/meta', metaRouter);

  app.use(API_PREFIX, api);

  app.get('/', (_request, response) => {
    response.status(200).json({
      name: 'PulseCheck API',
      api: API_PREFIX,
      health: { live: '/health/live', ready: '/health/ready' },
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export { asyncHandler };
