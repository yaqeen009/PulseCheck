import { z } from 'zod';

/**
 * Time windows for history and analytics queries. The supported set is bounded
 * so a client cannot request an unbounded scan, and it matches the retention
 * defaults documented in docs/ARCHITECTURE.md.
 */
export const TIME_WINDOWS = ['1h', '24h', '7d', '30d'] as const;
export type TimeWindow = (typeof TIME_WINDOWS)[number];

export const DEFAULT_TIME_WINDOW: TimeWindow = '24h';

export const TIME_WINDOW_MS: Record<TimeWindow, number> = {
  '1h': 60 * 60 * 1_000,
  '24h': 24 * 60 * 60 * 1_000,
  '7d': 7 * 24 * 60 * 60 * 1_000,
  '30d': 30 * 24 * 60 * 60 * 1_000,
};

export const TIME_WINDOW_LABELS: Record<TimeWindow, string> = {
  '1h': 'Last hour',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

/**
 * Number of buckets used for response-time series in each window. Chosen so a
 * chart holds 40-90 points: enough detail to see a spike, few enough to render
 * and to transfer cheaply.
 */
export const TIME_WINDOW_BUCKETS: Record<TimeWindow, number> = {
  '1h': 60,
  '24h': 48,
  '7d': 56,
  '30d': 60,
};

export const timeWindowSchema = z.enum(TIME_WINDOWS);

export function parseTimeWindow(
  value: unknown,
  fallback: TimeWindow = DEFAULT_TIME_WINDOW,
): TimeWindow {
  const result = timeWindowSchema.safeParse(value);
  return result.success ? result.data : fallback;
}

export function windowStart(window: TimeWindow, now: Date = new Date()): Date {
  return new Date(now.getTime() - TIME_WINDOW_MS[window]);
}

/** Width of a single chart bucket in milliseconds. */
export function bucketWidthMs(window: TimeWindow): number {
  return Math.ceil(TIME_WINDOW_MS[window] / TIME_WINDOW_BUCKETS[window]);
}

/**
 * Bucket boundaries for a window, oldest first. `end` is exclusive. Bucket
 * `i` covers `[start + i*width, start + (i+1)*width)`.
 */
export function bucketBoundaries(window: TimeWindow, now: Date = new Date()): number[] {
  const width = bucketWidthMs(window);
  const end = now.getTime();
  const start = end - TIME_WINDOW_MS[window];
  const boundaries: number[] = [];
  for (let index = 0; index <= TIME_WINDOW_BUCKETS[window]; index += 1) {
    boundaries.push(start + index * width);
  }
  return boundaries;
}

/** Index of the bucket that contains `timestamp`, or -1 when out of range. */
export function bucketIndexFor(
  window: TimeWindow,
  timestamp: number,
  now: Date = new Date(),
): number {
  const width = bucketWidthMs(window);
  const start = now.getTime() - TIME_WINDOW_MS[window];
  if (timestamp < start || timestamp >= now.getTime() + width) return -1;
  const index = Math.floor((timestamp - start) / width);
  if (index < 0 || index >= TIME_WINDOW_BUCKETS[window]) {
    // Clamp timestamps slightly in the future (clock skew) into the last bucket.
    return index >= TIME_WINDOW_BUCKETS[window] ? TIME_WINDOW_BUCKETS[window] - 1 : -1;
  }
  return index;
}
