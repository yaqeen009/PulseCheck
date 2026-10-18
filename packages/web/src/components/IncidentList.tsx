import type { IncidentActivityDto, IncidentDto } from '@pulsecheck/shared';
import { ShieldAlert } from 'lucide-react';
import type * as React from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime, formatDurationMs, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

export type IncidentRow = IncidentDto | IncidentActivityDto;

export interface IncidentListProps {
  incidents: IncidentRow[] | undefined;
  loading?: boolean;
  /** Hides the monitor column when every row belongs to the same monitor. */
  hideMonitor?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  className?: string;
}

/** Incident history rows: duration, peak status and the latest failure summary. */
export function IncidentList({
  incidents,
  loading = false,
  hideMonitor = false,
  emptyTitle = 'No incidents recorded',
  emptyDescription = 'An incident opens when a healthy monitor starts failing, and closes when it recovers.',
  emptyAction,
  className,
}: IncidentListProps) {
  if (loading && !incidents) {
    return (
      <div className={cn('space-y-2', className)} aria-busy="true">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (!incidents || incidents.length === 0) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
        className={className}
      />
    );
  }

  return (
    <div className={cn('rounded-lg border border-border', className)}>
      <Table>
        <TableHeader>
          <TableRow>
            {hideMonitor ? null : <TableHead>Monitor</TableHead>}
            <TableHead>Started</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Peak status</TableHead>
            <TableHead className="text-right">Failed checks</TableHead>
            <TableHead>Latest error</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {incidents.map((incident) => (
            <TableRow key={incident.id}>
              {hideMonitor ? null : (
                <TableCell className="whitespace-nowrap">
                  <Link
                    to={`/monitors/${incident.monitorId}`}
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    {incident.monitorName ?? 'Monitor'}
                  </Link>
                </TableCell>
              )}
              <TableCell className="whitespace-nowrap tabular text-muted-foreground">
                {formatDateTime(incident.startedAt)}
              </TableCell>
              <TableCell className="whitespace-nowrap tabular">
                {incident.ongoing ? (
                  <Badge variant="outline" className="border-down/25 bg-down/10 text-down">
                    Ongoing
                  </Badge>
                ) : (
                  formatDurationMs(incident.durationMs)
                )}
              </TableCell>
              <TableCell>
                <StatusBadge status={incident.peakStatus} />
              </TableCell>
              <TableCell className="text-right tabular">
                {formatNumber(incident.failedCheckCount)}
              </TableCell>
              <TableCell className="max-w-[24rem] text-muted-foreground">
                {incident.latestErrorSummary ?? '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
