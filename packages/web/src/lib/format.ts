/**
 * Display formatting.
 *
 * One rule matters more than the rest: a missing metric renders as an em dash,
 * never as `0`. The API returns `null` for "no data" and the UI must keep that
 * distinction visible (`uptimePercent: null` is not `0%`).
 */
export const EMPTY_VALUE = '—';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
});

/** Full local timestamp, e.g. `Oct 18, 2026, 11:37:04`. */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  const date = parseDate(value);
  return date ? dateTimeFormatter.format(date) : EMPTY_VALUE;
}

/** Local date without the time. */
export function formatDate(value: string | number | Date | null | undefined): string {
  const date = parseDate(value);
  return date ? dateFormatter.format(date) : EMPTY_VALUE;
}

/** Short "time since" label, falling back to an absolute date after a week. */
export function formatRelativeTime(
  value: string | number | Date | null | undefined,
  now: number = Date.now(),
): string {
  const date = parseDate(value);
  if (!date) return EMPTY_VALUE;
  const deltaMs = now - date.getTime();
  if (deltaMs < 0) return 'just now';
  const seconds = Math.floor(deltaMs / 1_000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(date);
}

/** Compact duration: `420 ms`, `1.42 s`, `2m 05s`, `3h 12m`, `2d 4h`. */
export function formatDurationMs(ms: number | null | undefined): string {
  if (!isFiniteNumber(ms)) return EMPTY_VALUE;
  const value = Math.max(0, ms);
  if (value < 1_000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(2)} s`;
  const totalSeconds = Math.floor(value / 1_000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  const minutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours}h ${String(minutes).padStart(2, '0')}m`;
  const hours = totalHours % 24;
  const days = Math.floor(totalHours / 24);
  return `${days}d ${String(hours).padStart(2, '0')}h`;
}

/** Response-time label, aliased for readability at call sites. */
export function formatResponseTime(ms: number | null | undefined): string {
  return formatDurationMs(ms);
}

/** Percentage with a `%` suffix; `null`/`NaN` render as an em dash. */
export function formatPercent(value: number | null | undefined, fractionDigits = 2): string {
  if (!isFiniteNumber(value)) return EMPTY_VALUE;
  return `${value.toFixed(fractionDigits)}%`;
}

/** Plain number; `null` renders as an em dash. */
export function formatNumber(value: number | null | undefined, fractionDigits = 0): string {
  if (!isFiniteNumber(value)) return EMPTY_VALUE;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** Check interval in human terms: `30s`, `5m`, `1h`, `24h`. */
export function formatInterval(seconds: number | null | undefined): string {
  if (!isFiniteNumber(seconds)) return EMPTY_VALUE;
  const value = Math.max(0, Math.round(seconds));
  if (value < 60) return `${value}s`;
  if (value % 3_600 === 0) return `${value / 3_600}h`;
  if (value % 60 === 0) return `${value / 60}m`;
  const minutes = Math.floor(value / 60);
  const remainder = value % 60;
  return `${minutes}m ${String(remainder).padStart(2, '0')}s`;
}

/** HTTP status code, or an em dash when no response was received. */
export function formatStatusCode(code: number | null | undefined): string {
  if (!isFiniteNumber(code)) return EMPTY_VALUE;
  return String(code);
}

/** Milliseconds value for a form field: empty string instead of `null`. */
export function msToInputValue(ms: number | null | undefined): string {
  return isFiniteNumber(ms) ? String(ms) : '';
}
