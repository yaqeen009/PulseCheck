import type { ResponseTimePointDto, TimeWindow } from '@pulsecheck/shared';
import { Activity } from 'lucide-react';
import * as React from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime, formatDurationMs, formatNumber } from '@/lib/format';
import { CHART_COLORS } from '@/lib/status';
import { cn } from '@/lib/utils';

/**
 * Response-time trend.
 *
 * Buckets with no checks carry `null` metrics from the API. The series is drawn
 * with `connectNulls={false}` so a gap in monitoring stays a visible gap instead
 * of being interpolated away.
 */
export interface ResponseTimeChartProps {
  points: ResponseTimePointDto[];
  window: TimeWindow;
  loading?: boolean;
  height?: number;
  className?: string;
}

interface ChartDatum {
  timestamp: number;
  avg: number | null;
  p95: number | null;
  checks: number;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: ChartDatum }>;
}

function formatAxisTick(timestamp: number, window: TimeWindow): string {
  const date = new Date(timestamp);
  if (window === '1h' || window === '24h') {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: '2-digit' });
}

function ChartTooltip({ active, payload }: ChartTooltipProps) {
  const datum = payload?.[0]?.payload;
  if (!active || !datum) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="font-medium text-popover-foreground">{formatDateTime(datum.timestamp)}</p>
      <dl className="mt-1 space-y-0.5 text-muted-foreground">
        <div className="flex items-center justify-between gap-4">
          <dt>Average</dt>
          <dd className="tabular text-foreground">{formatDurationMs(datum.avg)}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt>p95</dt>
          <dd className="tabular text-foreground">{formatDurationMs(datum.p95)}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt>Checks</dt>
          <dd className="tabular text-foreground">{formatNumber(datum.checks)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function ResponseTimeChart({
  points,
  window,
  loading = false,
  height = 260,
  className,
}: ResponseTimeChartProps) {
  const data = React.useMemo<ChartDatum[]>(
    () =>
      points.map((point) => ({
        timestamp: new Date(point.timestamp).getTime(),
        avg: point.avgResponseTimeMs,
        p95: point.p95ResponseTimeMs,
        checks: point.checks,
      })),
    [points],
  );

  const hasValues = data.some((datum) => datum.avg !== null || datum.p95 !== null);

  if (loading) {
    return <Skeleton className={cn('w-full', className)} style={{ height }} />;
  }

  if (data.length === 0 || !hasValues) {
    return (
      <EmptyState
        icon={Activity}
        title="No response-time data in this window"
        description="The chart fills in once checks have run during the selected period."
        className={className}
      />
    );
  }

  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="response-time-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.primary} stopOpacity={0.35} />
              <stop offset="100%" stopColor={CHART_COLORS.primary} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={['dataMin', 'dataMax']}
            scale="time"
            tickFormatter={(value: number) => formatAxisTick(value, window)}
            stroke={CHART_COLORS.axis}
            fontSize={11}
            tickLine={false}
            axisLine={{ stroke: CHART_COLORS.grid }}
            minTickGap={24}
          />
          <YAxis
            stroke={CHART_COLORS.axis}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(value: number) => `${value} ms`}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: CHART_COLORS.grid }} />
          <Area
            type="monotone"
            dataKey="avg"
            name="Average"
            stroke={CHART_COLORS.primary}
            strokeWidth={2}
            fill="url(#response-time-gradient)"
            connectNulls={false}
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 3 }}
          />
          <Line
            type="monotone"
            dataKey="p95"
            name="p95"
            stroke={CHART_COLORS.axis}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            connectNulls={false}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
