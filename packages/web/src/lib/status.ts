import {
  ERROR_CATEGORY_LABELS,
  STATUS_LABELS,
  STATUS_SEVERITY,
  type ErrorCategory,
  type MonitorStatus,
} from '@pulsecheck/shared';
import { Activity, CheckCircle2, CircleDashed, CirclePause, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Status presentation.
 *
 * The status model itself lives in `@pulsecheck/shared` (labels, severity, the
 * transition rules). This module only adds what the browser needs: a colour token
 * and an icon. Every status colour comes from a CSS variable so both themes stay
 * legible and the palette cannot drift inside a component.
 */
export interface StatusPresentation {
  label: string;
  /** Foreground/text colour for the status. */
  textClass: string;
  /** Dot/indicator background. */
  dotClass: string;
  /** Soft badge treatment (tint background + status colour). */
  badgeClass: string;
  /** Solid badge treatment for high-emphasis places. */
  solidClass: string;
  icon: LucideIcon;
  severity: number;
}

export const STATUS_PRESENTATION: Record<MonitorStatus, StatusPresentation> = {
  HEALTHY: {
    label: STATUS_LABELS.HEALTHY,
    textClass: 'text-healthy',
    dotClass: 'bg-healthy',
    badgeClass: 'bg-healthy/10 text-healthy border-healthy/25',
    solidClass: 'bg-healthy text-healthy-foreground',
    icon: CheckCircle2,
    severity: STATUS_SEVERITY.HEALTHY,
  },
  DEGRADED: {
    label: STATUS_LABELS.DEGRADED,
    textClass: 'text-degraded',
    dotClass: 'bg-degraded',
    badgeClass: 'bg-degraded/10 text-degraded border-degraded/25',
    solidClass: 'bg-degraded text-degraded-foreground',
    icon: TriangleAlert,
    severity: STATUS_SEVERITY.DEGRADED,
  },
  DOWN: {
    label: STATUS_LABELS.DOWN,
    textClass: 'text-down',
    dotClass: 'bg-down',
    badgeClass: 'bg-down/10 text-down border-down/25',
    solidClass: 'bg-down text-down-foreground',
    icon: Activity,
    severity: STATUS_SEVERITY.DOWN,
  },
  PAUSED: {
    label: STATUS_LABELS.PAUSED,
    textClass: 'text-paused',
    dotClass: 'bg-paused',
    badgeClass: 'bg-paused/10 text-paused border-paused/25',
    solidClass: 'bg-paused text-paused-foreground',
    icon: CirclePause,
    severity: STATUS_SEVERITY.PAUSED,
  },
  PENDING: {
    label: STATUS_LABELS.PENDING,
    textClass: 'text-pending',
    dotClass: 'bg-pending',
    badgeClass: 'bg-pending/10 text-pending border-pending/25',
    solidClass: 'bg-pending text-pending-foreground',
    icon: CircleDashed,
    severity: STATUS_SEVERITY.PENDING,
  },
};

export function statusPresentation(status: MonitorStatus): StatusPresentation {
  return STATUS_PRESENTATION[status];
}

/** Options for status filters, worst-first so incidents sort to the top. */
export const STATUS_FILTER_OPTIONS: ReadonlyArray<{ value: MonitorStatus | 'ALL'; label: string }> =
  [
    { value: 'ALL', label: 'All statuses' },
    { value: 'HEALTHY', label: STATUS_LABELS.HEALTHY },
    { value: 'DEGRADED', label: STATUS_LABELS.DEGRADED },
    { value: 'DOWN', label: STATUS_LABELS.DOWN },
    { value: 'PAUSED', label: STATUS_LABELS.PAUSED },
    { value: 'PENDING', label: STATUS_LABELS.PENDING },
  ];

/** Human sentence for a failure category (used by check tables and incidents). */
export function errorCategoryLabel(category: ErrorCategory | null | undefined): string {
  if (!category) return '—';
  return ERROR_CATEGORY_LABELS[category];
}

/** Indicates whether a category means "no HTTP response was received". */
export function isDownCategory(category: ErrorCategory | null | undefined): boolean {
  return category !== null && category !== undefined && category !== 'UNEXPECTED_STATUS';
}

/**
 * Chart-safe status colours.
 *
 * Recharts writes plain SVG `stroke`/`fill` attributes, where CSS custom
 * properties resolve inconsistently across browsers, so charts use literal HSL
 * values instead of the CSS variables. They match the dark-theme tokens above.
 */
export const STATUS_CHART_COLORS: Record<MonitorStatus, string> = {
  HEALTHY: 'hsl(154 58% 46%)',
  DEGRADED: 'hsl(35 94% 56%)',
  DOWN: 'hsl(0 74% 60%)',
  PAUSED: 'hsl(215 16% 58%)',
  PENDING: 'hsl(217 40% 66%)',
};

/** Literal chart colours used for generic series (grid, axes, primary line). */
export const CHART_COLORS = {
  primary: 'hsl(217 91% 62%)',
  grid: 'hsl(217 20% 22%)',
  axis: 'hsl(215 18% 63%)',
  tooltipSurface: 'hsl(222 24% 11%)',
} as const;

/** Chart colour for a status. */
export function statusChartColor(status: MonitorStatus): string {
  return STATUS_CHART_COLORS[status];
}
