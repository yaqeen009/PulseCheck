import type { ApiErrorBody, ApiErrorCode, ValidationIssue } from '@pulsecheck/shared';

/**
 * Application error type.
 *
 * Anything thrown as an `AppError` is safe to show a client: the status code,
 * the machine-readable code and the message are all intentional. Everything else
 * is treated as an internal fault and replaced with a generic message by the
 * error middleware, so stack traces, SQL and driver internals never leak.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
    Error.captureStackTrace?.(this, AppError);
  }
}

export const badRequest = (message: string, details?: unknown): AppError =>
  new AppError(400, 'VALIDATION_ERROR', message, details);

export const validationError = (issues: ValidationIssue[]): AppError =>
  new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', { issues });

export const unauthenticated = (message = 'Authentication required'): AppError =>
  new AppError(401, 'UNAUTHENTICATED', message);

export const forbidden = (message = 'You do not have access to this resource'): AppError =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Resource not found'): AppError =>
  new AppError(404, 'NOT_FOUND', message);

export const conflict = (message: string): AppError => new AppError(409, 'CONFLICT', message);

export const limitExceeded = (message: string): AppError =>
  new AppError(409, 'LIMIT_EXCEEDED', message);

export const rateLimited = (message = 'Too many requests. Try again later.'): AppError =>
  new AppError(429, 'RATE_LIMITED', message);

export const payloadTooLarge = (message = 'Request payload is too large'): AppError =>
  new AppError(413, 'PAYLOAD_TOO_LARGE', message);

export const serviceUnavailable = (message = 'Service temporarily unavailable'): AppError =>
  new AppError(503, 'SERVICE_UNAVAILABLE', message);

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Build the JSON body for a failed request. */
export function toErrorBody(error: AppError, requestId?: string): ApiErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
      ...(requestId ? { requestId } : {}),
    },
  };
}

/** Generic body used for unexpected (non-AppError) failures. */
export function toInternalErrorBody(requestId?: string): ApiErrorBody {
  return {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      ...(requestId ? { requestId } : {}),
    },
  };
}
