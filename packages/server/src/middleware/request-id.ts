import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../logger.js';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Attach a correlation id to every request and bind a child logger to it, so
 * every log line for one request can be found with a single field.
 * An inbound `X-Request-Id` is honoured only if it looks like a UUID, to stop a
 * client injecting arbitrary content into logs.
 */
export function requestIdMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const inbound = request.header(REQUEST_ID_HEADER);
  const requestId =
    inbound && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(inbound)
      ? inbound
      : randomUUID();

  request.requestId = requestId;
  request.log = logger.child({ requestId });
  response.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}
