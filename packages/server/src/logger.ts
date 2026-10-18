import { pino, type Logger } from 'pino';
import { env, isProduction, SERVICE_NAME } from './env.js';

/**
 * Structured logging.
 *
 * Redaction is deliberate and covers everything that could carry a credential or
 * user content: authorization headers, tokens, and the custom request headers /
 * bodies of monitored targets (see `monitoring/` - those are never logged at all).
 */
const redactPaths = [
  'req.headers.authorization',
  'req.headers["x-api-key"]',
  'token',
  '*.token',
  'tokenHash',
  '*.tokenHash',
  'headers',
  '*.headers',
  'body',
  '*.body',
];

export const logger: Logger = pino({
  name: SERVICE_NAME,
  level: env.LOG_LEVEL,
  base: { service: SERVICE_NAME, env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: redactPaths, censor: '[redacted]' },
  ...(env.LOG_PRETTY && !isProduction
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname,service,env',
            messageFormat: '{msg}',
          },
        },
      }
    : {}),
});

export type { Logger };
