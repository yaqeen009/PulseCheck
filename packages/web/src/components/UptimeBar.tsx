import type { UptimeStats } from '@pulsecheck/shared';
import { cn } from '@/lib/utils';

export interface UptimeBarProps {
  stats: UptimeStats;
  className?: string;
  /** Hide the counts line under the bar (for very dense layouts). */
  hideSummary?: boolean;
}

/**
 * Uptime bar.
 *
 * When the window holds no checks the bar renders as an explicit "No data yet"
 * strip. It never shows an empty green bar, because silence is not 100% uptime.
 */
export function UptimeBar({ stats, className, hideSummary = false }: UptimeBarProps) {
  const hasData = stats.totalChecks > 0;
  const successPercent = hasData ? (stats.successfulChecks / stats.totalChecks) * 100 : 0;
  const failurePercent = hasData ? (stats.failedChecks / stats.totalChecks) * 100 : 0;

  return (
    <div className={cn('space-y-1.5', className)}>
      <div
        className={cn(
          'flex h-2 w-full overflow-hidden rounded-full bg-muted',
          !hasData && 'items-center justify-center',
        )}
        role="img"
        aria-label={
          hasData
            ? `Uptime bar: ${stats.successfulChecks} of ${stats.totalChecks} checks met expectations`
            : 'Uptime bar: no checks recorded in this window'
        }
      >
        {hasData ? (
          <>
            <span
              className="h-full bg-healthy transition-[width] duration-300"
              style={{ width: `${successPercent}%` }}
            />
            <span className="h-full bg-down" style={{ width: `${failurePercent}%` }} />
          </>
        ) : (
          <span className="text-[9px] uppercase tracking-wide text-muted-foreground">no data</span>
        )}
      </div>
      {hideSummary ? null : (
        <p className="text-xs text-muted-foreground">
          {hasData ? (
            <>
              <span className="tabular">{stats.totalChecks}</span> checks ·{' '}
              <span className="tabular text-healthy">{stats.successfulChecks}</span> met
              expectations · <span className="tabular text-down">{stats.failedChecks}</span> failed
            </>
          ) : (
            'No data yet — checks will appear after the first run'
          )}
        </p>
      )}
    </div>
  );
}
