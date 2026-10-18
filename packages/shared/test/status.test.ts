import { describe, expect, it } from 'vitest';
import {
  DOWN_ERROR_CATEGORIES,
  ERROR_CATEGORIES,
  ERROR_CATEGORY_LABELS,
  MONITOR_STATUSES,
  STATUS_LABELS,
  STATUS_SEVERITY,
  isErrorCategory,
  isResponseReceivedCategory,
  opensIncident,
  resolvesIncident,
  statusFromOutcome,
  type ErrorCategory,
  type MonitorStatus,
} from '../src/status.js';

describe('statusFromOutcome', () => {
  it('returns HEALTHY for a successful check within the degraded threshold', () => {
    expect(statusFromOutcome({ success: true, responseTimeMs: 120, errorCategory: null })).toBe(
      'HEALTHY',
    );
    expect(
      statusFromOutcome({
        success: true,
        responseTimeMs: 400,
        errorCategory: null,
        degradedResponseTimeMs: 500,
      }),
    ).toBe('HEALTHY');
  });

  it('returns DEGRADED for a successful but slow check', () => {
    expect(
      statusFromOutcome({
        success: true,
        responseTimeMs: 900,
        degradedResponseTimeMs: 500,
      }),
    ).toBe('DEGRADED');
  });

  it('does not degrade at exactly the threshold (strictly greater)', () => {
    expect(
      statusFromOutcome({
        success: true,
        responseTimeMs: 500,
        degradedResponseTimeMs: 500,
      }),
    ).toBe('HEALTHY');
  });

  it.each(DOWN_ERROR_CATEGORIES)('maps transport failure %s to DOWN', (category) => {
    expect(statusFromOutcome({ success: false, responseTimeMs: 10, errorCategory: category })).toBe(
      'DOWN',
    );
  });

  it('maps UNEXPECTED_STATUS to DEGRADED because the target did answer', () => {
    expect(
      statusFromOutcome({
        success: false,
        responseTimeMs: 10,
        errorCategory: 'UNEXPECTED_STATUS',
      }),
    ).toBe('DEGRADED');
  });

  it('falls back to DEGRADED for a failure with no category', () => {
    // A failure without a category cannot be proven to be a transport failure,
    // so the safer, less alarming classification is used.
    expect(statusFromOutcome({ success: false, responseTimeMs: 10 })).toBe('DEGRADED');
  });

  it('ignores a non-positive degraded threshold', () => {
    expect(
      statusFromOutcome({ success: true, responseTimeMs: 5_000, degradedResponseTimeMs: 0 }),
    ).toBe('HEALTHY');
  });
});

describe('incident transitions', () => {
  const statuses = MONITOR_STATUSES;

  it('opens an incident only from HEALTHY or PENDING into DOWN or DEGRADED', () => {
    const opened = new Set<string>();
    for (const previous of statuses) {
      for (const next of statuses) {
        if (opensIncident(previous, next)) opened.add(`${previous}->${next}`);
      }
    }

    expect([...opened].sort()).toEqual(
      ['HEALTHY->DEGRADED', 'HEALTHY->DOWN', 'PENDING->DEGRADED', 'PENDING->DOWN'].sort(),
    );
  });

  it('never opens an incident for a PAUSED monitor', () => {
    for (const next of statuses) {
      expect(opensIncident('PAUSED', next)).toBe(false);
    }
  });

  it('does not open a second incident while already failing', () => {
    expect(opensIncident('DOWN', 'DOWN')).toBe(false);
    expect(opensIncident('DOWN', 'DEGRADED')).toBe(false);
    expect(opensIncident('DEGRADED', 'DOWN')).toBe(false);
  });

  it('resolves an incident only when a failing monitor returns to HEALTHY', () => {
    expect(resolvesIncident('DOWN', 'HEALTHY')).toBe(true);
    expect(resolvesIncident('DEGRADED', 'HEALTHY')).toBe(true);
    expect(resolvesIncident('DOWN', 'DEGRADED')).toBe(false);
    expect(resolvesIncident('HEALTHY', 'HEALTHY')).toBe(false);
    expect(resolvesIncident('PAUSED', 'HEALTHY')).toBe(false);
  });
});

describe('catalogue invariants', () => {
  it('labels and severity cover every status', () => {
    for (const status of MONITOR_STATUSES) {
      expect(STATUS_LABELS[status]).toBeTruthy();
      expect(typeof STATUS_SEVERITY[status]).toBe('number');
    }
  });

  it('ranks DOWN as the most severe status', () => {
    const worst = ([...MONITOR_STATUSES] as MonitorStatus[]).reduce((a, b) =>
      STATUS_SEVERITY[a] <= STATUS_SEVERITY[b] ? a : b,
    );
    expect(worst).toBe('DOWN');
  });

  it('labels every error category', () => {
    for (const category of ERROR_CATEGORIES) {
      expect(ERROR_CATEGORY_LABELS[category]).toBeTruthy();
    }
  });

  it('recognises only real categories', () => {
    expect(isErrorCategory('TIMEOUT')).toBe(true);
    expect(isErrorCategory('NOT_A_CATEGORY')).toBe(false);
    expect(isErrorCategory(42)).toBe(false);
    expect(isErrorCategory(null)).toBe(false);
  });

  it('treats only UNEXPECTED_STATUS as "a response was received"', () => {
    for (const category of ERROR_CATEGORIES as readonly ErrorCategory[]) {
      expect(isResponseReceivedCategory(category)).toBe(category === 'UNEXPECTED_STATUS');
    }
  });
});
