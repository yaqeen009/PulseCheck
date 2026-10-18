import { describe, expect, it } from 'vitest';
import {
  aggregateUptime,
  computeUptime,
  percentile,
  type UptimeCheckSample,
} from '../src/uptime.js';

const sample = (
  success: boolean,
  responseTimeMs: number,
  httpStatusCode: number | null,
): UptimeCheckSample => ({
  success,
  responseTimeMs,
  httpStatusCode,
});

describe('computeUptime', () => {
  it('returns nulls - never zeros - when the window has no checks', () => {
    const stats = computeUptime([]);
    expect(stats).toEqual({
      totalChecks: 0,
      successfulChecks: 0,
      failedChecks: 0,
      respondedChecks: 0,
      uptimePercent: null,
      availabilityPercent: null,
      avgResponseTimeMs: null,
      minResponseTimeMs: null,
      maxResponseTimeMs: null,
      p95ResponseTimeMs: null,
    });
  });

  it('reports 0% only for a real window of failed checks', () => {
    const stats = computeUptime([sample(false, 30, null), sample(false, 40, null)]);
    expect(stats.uptimePercent).toBe(0);
    expect(stats.availabilityPercent).toBe(0);
    expect(stats.failedChecks).toBe(2);
    expect(stats.totalChecks).toBe(2);
  });

  it('separates uptime (met expectations) from availability (answered at all)', () => {
    const stats = computeUptime([
      sample(true, 100, 200),
      sample(false, 120, 500), // answered, but the wrong status
      sample(false, 5_000, null), // never answered
    ]);
    expect(stats.totalChecks).toBe(3);
    expect(stats.successfulChecks).toBe(1);
    expect(stats.respondedChecks).toBe(2);
    expect(stats.uptimePercent).toBeCloseTo(33.33, 2);
    expect(stats.availabilityPercent).toBeCloseTo(66.67, 2);
  });

  it('computes latency aggregates over every check', () => {
    const stats = computeUptime([
      sample(true, 100, 200),
      sample(true, 300, 200),
      sample(false, 200, null),
    ]);
    expect(stats.avgResponseTimeMs).toBe(200);
    expect(stats.minResponseTimeMs).toBe(100);
    expect(stats.maxResponseTimeMs).toBe(300);
    expect(stats.p95ResponseTimeMs).toBe(300);
  });

  it('clamps negative and non-finite durations instead of poisoning the average', () => {
    const stats = computeUptime([sample(true, -50, 200), sample(true, Number.NaN, 200)]);
    expect(stats.avgResponseTimeMs).toBe(0);
    expect(stats.minResponseTimeMs).toBe(0);
    expect(stats.maxResponseTimeMs).toBe(0);
  });
});

describe('percentile', () => {
  it('returns null for an empty sample set', () => {
    expect(percentile([], 0.95)).toBeNull();
  });

  it('returns the extremes at fraction 0 and 1', () => {
    expect(percentile([1, 2, 3, 4], 0)).toBe(1);
    expect(percentile([1, 2, 3, 4], 1)).toBe(4);
  });

  it('picks the nearest-rank value for the p95 of 1..100', () => {
    const values = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(percentile(values, 0.95)).toBe(95);
  });
});

describe('aggregateUptime', () => {
  it('returns the empty (null) shape when no monitor has data', () => {
    expect(aggregateUptime([computeUptime([]), computeUptime([])])).toEqual(computeUptime([]));
  });

  it('excludes monitors with no checks rather than counting them as 0% or 100%', () => {
    const withData = computeUptime([sample(true, 100, 200), sample(true, 100, 200)]);
    const withoutData = computeUptime([]);
    const stats = aggregateUptime([withData, withoutData]);
    expect(stats.totalChecks).toBe(2);
    expect(stats.uptimePercent).toBe(100);
  });

  it('weights the average latency by check count', () => {
    const fast = computeUptime([sample(true, 10, 200)]); // 1 check @ 10ms
    const slow = computeUptime(Array.from({ length: 9 }, () => sample(true, 110, 200))); // 9 @ 110ms
    const stats = aggregateUptime([fast, slow]);
    // (10*1 + 110*9) / 10 = 100
    expect(stats.avgResponseTimeMs).toBe(100);
    expect(stats.minResponseTimeMs).toBe(10);
    expect(stats.maxResponseTimeMs).toBe(110);
  });
});
