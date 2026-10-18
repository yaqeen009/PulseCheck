import { describe, expect, it } from 'vitest';
import {
  EMPTY_VALUE,
  formatDateTime,
  formatDurationMs,
  formatInterval,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatResponseTime,
  formatStatusCode,
} from '@/lib/format';

describe('format helpers', () => {
  it('renders missing metrics as an em dash, never as zero', () => {
    expect(formatPercent(null)).toBe(EMPTY_VALUE);
    expect(formatPercent(undefined)).toBe(EMPTY_VALUE);
    expect(formatNumber(null)).toBe(EMPTY_VALUE);
    expect(formatDurationMs(null)).toBe(EMPTY_VALUE);
    expect(formatStatusCode(null)).toBe(EMPTY_VALUE);
    expect(formatDateTime(null)).toBe(EMPTY_VALUE);
    expect(formatRelativeTime(null)).toBe(EMPTY_VALUE);
  });

  it('keeps a real zero distinguishable from missing data', () => {
    expect(formatPercent(0)).toBe('0.00%');
    expect(formatNumber(0)).toBe('0');
    expect(formatDurationMs(0)).toBe('0 ms');
  });

  it('formats percentages with the requested precision', () => {
    expect(formatPercent(99.954, 2)).toBe('99.95%');
    expect(formatPercent(100, 1)).toBe('100.0%');
  });

  it('formats durations across units', () => {
    expect(formatDurationMs(420)).toBe('420 ms');
    expect(formatDurationMs(1_420)).toBe('1.42 s');
    expect(formatDurationMs(65_000)).toBe('1m 05s');
    expect(formatDurationMs(3_600_000)).toBe('1h 00m');
    expect(formatDurationMs(180_000_000)).toBe('2d 02h');
    expect(formatResponseTime(950)).toBe('950 ms');
  });

  it('formats check intervals', () => {
    expect(formatInterval(30)).toBe('30s');
    expect(formatInterval(60)).toBe('1m');
    expect(formatInterval(90)).toBe('1m 30s');
    expect(formatInterval(3_600)).toBe('1h');
    expect(formatInterval(86_400)).toBe('24h');
    expect(formatInterval(null)).toBe(EMPTY_VALUE);
  });

  it('describes recent timestamps relatively', () => {
    const now = Date.parse('2026-10-18T12:00:00.000Z');
    expect(formatRelativeTime('2026-10-18T11:59:58.000Z', now)).toBe('just now');
    expect(formatRelativeTime('2026-10-18T11:59:30.000Z', now)).toBe('30s ago');
    expect(formatRelativeTime('2026-10-18T11:45:00.000Z', now)).toBe('15m ago');
    expect(formatRelativeTime('2026-10-18T09:00:00.000Z', now)).toBe('3h ago');
    expect(formatRelativeTime('2026-10-16T12:00:00.000Z', now)).toBe('2d ago');
  });
});
