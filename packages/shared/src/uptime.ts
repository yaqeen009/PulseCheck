/**
 * Uptime and latency statistics.
 *
 * Retention and honesty rules:
 *  - `uptimePercent` is `null` when the window contains no checks, so the UI can
 *    distinguish "no data" from "0% uptime". Never render null as 0%.
 *  - `availabilityPercent` counts checks that received any HTTP response, even a
 *    500. It answers "did the target answer at all?" while `uptimePercent`
 *    answers "did it meet expectations?".
 */

export interface UptimeCheckSample {
  success: boolean;
  responseTimeMs: number;
  httpStatusCode?: number | null;
}

export interface UptimeStats {
  totalChecks: number;
  successfulChecks: number;
  failedChecks: number;
  respondedChecks: number;
  /** Percentage of checks that met expectations, or null when there is no data. */
  uptimePercent: number | null;
  /** Percentage of checks that received any HTTP response, or null. */
  availabilityPercent: number | null;
  avgResponseTimeMs: number | null;
  minResponseTimeMs: number | null;
  maxResponseTimeMs: number | null;
  p95ResponseTimeMs: number | null;
}

export function percentile(sortedValues: readonly number[], fraction: number): number | null {
  if (sortedValues.length === 0) return null;
  if (fraction <= 0) return sortedValues[0] ?? null;
  if (fraction >= 1) return sortedValues[sortedValues.length - 1] ?? null;
  const index = Math.min(sortedValues.length - 1, Math.ceil(fraction * sortedValues.length) - 1);
  return sortedValues[index] ?? null;
}

function ratioPercent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

export function computeUptime(samples: readonly UptimeCheckSample[]): UptimeStats {
  const totalChecks = samples.length;
  if (totalChecks === 0) {
    return {
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
    };
  }

  let successfulChecks = 0;
  let respondedChecks = 0;
  let totalResponseTime = 0;
  const durations: number[] = [];

  for (const sample of samples) {
    if (sample.success) successfulChecks += 1;
    if (sample.httpStatusCode !== null && sample.httpStatusCode !== undefined) {
      respondedChecks += 1;
    }
    const duration = Number.isFinite(sample.responseTimeMs)
      ? Math.max(0, sample.responseTimeMs)
      : 0;
    totalResponseTime += duration;
    durations.push(duration);
  }

  durations.sort((a, b) => a - b);

  return {
    totalChecks,
    successfulChecks,
    failedChecks: totalChecks - successfulChecks,
    respondedChecks,
    uptimePercent: ratioPercent(successfulChecks, totalChecks),
    availabilityPercent: ratioPercent(respondedChecks, totalChecks),
    avgResponseTimeMs: Math.round(totalResponseTime / totalChecks),
    minResponseTimeMs: durations[0] ?? null,
    maxResponseTimeMs: durations[durations.length - 1] ?? null,
    p95ResponseTimeMs: percentile(durations, 0.95),
  };
}

/**
 * Uptime contribution of a single monitor inside a multi-monitor summary.
 * Monitors with no checks in the window are excluded rather than counted as
 * 100% or 0%.
 */
export function aggregateUptime(perMonitor: readonly UptimeStats[]): UptimeStats {
  const withData = perMonitor.filter((stats) => stats.totalChecks > 0);
  if (withData.length === 0) return computeUptime([]);

  let totalChecks = 0;
  let successfulChecks = 0;
  let respondedChecks = 0;
  let weightedDuration = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  const p95s: number[] = [];

  for (const stats of withData) {
    totalChecks += stats.totalChecks;
    successfulChecks += stats.successfulChecks;
    respondedChecks += stats.respondedChecks;
    if (stats.avgResponseTimeMs !== null) {
      weightedDuration += stats.avgResponseTimeMs * stats.totalChecks;
    }
    if (stats.minResponseTimeMs !== null) min = Math.min(min, stats.minResponseTimeMs);
    if (stats.maxResponseTimeMs !== null) max = Math.max(max, stats.maxResponseTimeMs);
    if (stats.p95ResponseTimeMs !== null) p95s.push(stats.p95ResponseTimeMs);
  }

  p95s.sort((a, b) => a - b);

  return {
    totalChecks,
    successfulChecks,
    failedChecks: totalChecks - successfulChecks,
    respondedChecks,
    uptimePercent: ratioPercent(successfulChecks, totalChecks),
    availabilityPercent: ratioPercent(respondedChecks, totalChecks),
    avgResponseTimeMs: totalChecks > 0 ? Math.round(weightedDuration / totalChecks) : null,
    minResponseTimeMs: Number.isFinite(min) ? min : null,
    maxResponseTimeMs: max > 0 ? max : null,
    p95ResponseTimeMs: percentile(p95s, 0.95),
  };
}
