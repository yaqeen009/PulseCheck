import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIME_WINDOW,
  TIME_WINDOW_BUCKETS,
  TIME_WINDOW_LABELS,
  TIME_WINDOW_MS,
  TIME_WINDOWS,
  bucketBoundaries,
  bucketIndexFor,
  bucketWidthMs,
  parseTimeWindow,
  windowStart,
} from '../src/windows.js';

const NOW = new Date('2026-10-18T12:00:00.000Z');

describe('window metadata', () => {
  it('has a label, a duration and a bucket count for every window', () => {
    for (const window of TIME_WINDOWS) {
      expect(TIME_WINDOW_MS[window]).toBeGreaterThan(0);
      expect(TIME_WINDOW_LABELS[window]).toBeTruthy();
      expect(TIME_WINDOW_BUCKETS[window]).toBeGreaterThan(10);
    }
  });

  it('keeps every window inside 40-90 chart points', () => {
    for (const window of TIME_WINDOWS) {
      const points = TIME_WINDOW_BUCKETS[window];
      expect(points).toBeGreaterThanOrEqual(40);
      expect(points).toBeLessThanOrEqual(90);
    }
  });
});

describe('windowStart', () => {
  it('subtracts exactly the window duration', () => {
    expect(windowStart('1h', NOW).toISOString()).toBe('2026-10-18T11:00:00.000Z');
    expect(windowStart('24h', NOW).toISOString()).toBe('2026-10-17T12:00:00.000Z');
    expect(windowStart('7d', NOW).toISOString()).toBe('2026-10-11T12:00:00.000Z');
    expect(windowStart('30d', NOW).toISOString()).toBe('2026-09-18T12:00:00.000Z');
  });
});

describe('bucketBoundaries', () => {
  it('produces bucketCount + 1 boundaries spanning the window', () => {
    for (const window of TIME_WINDOWS) {
      const boundaries = bucketBoundaries(window, NOW);
      expect(boundaries).toHaveLength(TIME_WINDOW_BUCKETS[window] + 1);
      expect(boundaries[0]).toBe(NOW.getTime() - TIME_WINDOW_MS[window]);
      // Buckets are equal width and end at or after `now`.
      const width = bucketWidthMs(window);
      for (let index = 1; index < boundaries.length; index += 1) {
        expect((boundaries[index] as number) - (boundaries[index - 1] as number)).toBe(width);
      }
      expect(boundaries[boundaries.length - 1]).toBeGreaterThanOrEqual(NOW.getTime());
    }
  });
});

describe('bucketIndexFor', () => {
  it('maps the oldest and newest instants into the first and last bucket', () => {
    expect(bucketIndexFor('24h', NOW.getTime() - TIME_WINDOW_MS['24h'], NOW)).toBe(0);
    expect(bucketIndexFor('24h', NOW.getTime() - 1, NOW)).toBe(TIME_WINDOW_BUCKETS['24h'] - 1);
  });

  it('returns -1 for a timestamp older than the window', () => {
    expect(bucketIndexFor('1h', NOW.getTime() - TIME_WINDOW_MS['1h'] - 1, NOW)).toBe(-1);
  });

  it('clamps slightly-future timestamps (clock skew) into the last bucket', () => {
    expect(bucketIndexFor('1h', NOW.getTime() + 1, NOW)).toBe(TIME_WINDOW_BUCKETS['1h'] - 1);
  });

  it('is monotonic across a window', () => {
    let previous = -1;
    for (let offset = 0; offset < TIME_WINDOW_MS['7d']; offset += TIME_WINDOW_MS['7d'] / 60) {
      const index = bucketIndexFor('7d', NOW.getTime() - TIME_WINDOW_MS['7d'] + offset, NOW);
      expect(index).toBeGreaterThanOrEqual(previous);
      previous = index;
    }
  });
});

describe('parseTimeWindow', () => {
  it('accepts known windows', () => {
    for (const window of TIME_WINDOWS) {
      expect(parseTimeWindow(window)).toBe(window);
    }
  });

  it('falls back to the default for anything unknown', () => {
    expect(parseTimeWindow('5m')).toBe(DEFAULT_TIME_WINDOW);
    expect(parseTimeWindow(undefined)).toBe(DEFAULT_TIME_WINDOW);
    expect(parseTimeWindow(42)).toBe(DEFAULT_TIME_WINDOW);
  });
});
