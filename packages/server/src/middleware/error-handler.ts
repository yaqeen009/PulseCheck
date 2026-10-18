import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import type { ValidationIssue } from '@pulsecheck/shared';
import {
  AppError,
  isAppError,
  notFound,
  toErrorBody,
  toInternalErrorBody,
  validationError,
} from '../errors.js';
import { logger } from '../logger.js';

export function zodIssuesToValidationIssues(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * Validate `req.body` against a Zod schema and replace it with the parsed,
 * coerced result. Unknown keys are rejected by `.strict()` schemas.
 */
export function validateBody(schema: ZodTypeAny) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const result = schema.safeParse(request.body ?? {});
    if (!result.success) {
      next(validationError(zodIssuesToValidationIssues(result.error)));
      return;
    }
    request.body = result.data;
    next();
  };
}

/** Validate `req.query`. The parsed value is stored on `res.locals.query`. */
export function validateQuery(schema: ZodTypeAny) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const result = schema.safeParse(request.query ?? {});
    if (!result.success) {
      next(validationError(zodIssuesToValidationIssues(result.error)));
      return;
    }
    response.locals.query = result.data;
    next();
  };
}

/** 404 handler for unmatched routes. */
export function notFoundHandler(request: Request, _response: Response, next: NextFunction): void {
  next(notFound(`Route ${request.method} ${request.path} does not exist`));
}

/**
 * Central error handler.
 *
 * Only `AppError`s are exposed. Anything else is logged with full detail and
 * answered with a generic body, so database errors, driver messages and stack
 * traces stay server-side.
 */
export function errorHandler(
  error: unknown,
  request: Request,
  response: Response,
  _next: NextFunction,
): void {
  const requestId = request.requestId;
  const log = request.log ?? logger;

  if (response.headersSent) {
    log.error({ err: error }, 'error after response started; closing connection');
    response.destroy();
    return;
  }

  if (isAppError(error)) {
    if (error.status >= 500) {
      log.error({ err: error, code: error.code }, 'request failed');
    } else if (error.status === 429) {
      log.warn({ code: error.code, path: request.path }, 'request rate limited');
    } else {
      log.info({ code: error.code, status: error.status, path: request.path }, 'request rejected');
    }
    response.status(error.status).json(toErrorBody(error, requestId));
    return;
  }

  if (error instanceof ZodError) {
    const appError = validationError(zodIssuesToValidationIssues(error));
    response.status(appError.status).json(toErrorBody(appError, requestId));
    return;
  }

  // Express body-parser raised these before any route ran.
  const maybeStatusError = error as { status?: number; type?: string };
  if (maybeStatusError?.status === 413 || maybeStatusError?.type === 'entity.too.large') {
    const appError = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request payload is too large');
    response.status(appError.status).json(toErrorBody(appError, requestId));
    return;
  }
  if (maybeStatusError?.type === 'entity.parse.failed') {
    const appError = new AppError(400, 'VALIDATION_ERROR', 'Request body is not valid JSON');
    response.status(appError.status).json(toErrorBody(appError, requestId));
    return;
  }

  log.error({ err: error }, 'unhandled exception');
  response.status(500).json(toInternalErrorBody(requestId));
}

/**
 * Wrap an async route handler so rejected promises reach the error middleware.
 * Express 5 forwards rejections automatically, but wrapping keeps behaviour
 * explicit and identical for every handler.
 */
export function asyncHandler<T extends Request>(
  handler: (request: T, response: Response, next: NextFunction) => Promise<unknown>,
) {
  return (request: T, response: Response, next: NextFunction): void => {
    handler(request, response, next).catch(next);
  };
}
