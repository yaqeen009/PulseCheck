import type { MonitorActivityDto } from '@pulsecheck/shared';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/EmptyState';
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
import { formatDurationMs, formatRelativeTime, formatStatusCode } from '@/lib/format';

export interface RecentChecksListProps {
  checks: MonitorActivityDto[] | undefined;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}

/** Read-only window onto the newest check results across all monitors. */
export function RecentChecksList({
  checks,
  loading = false,
  emptyTitle = 'No checks yet',
  emptyDescription = 'Scheduled checks will appear here as soon as they complete.',
  className,
}: RecentChecksListProps) {
  if (loading && !checks) {
    return (
      <div className={className} aria-busy="true">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="mb-2 h-9 w-full" />
        ))}
      </div>
    );
  }

  if (!checks || checks.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} className={className} />;
  }

  return (
    <div className={className}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Monitor</TableHead>
            <TableHead>Result</TableHead>
            <TableHead>HTTP</TableHead>
            <TableHead className="text-right">Duration</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {checks.map((check) => (
            <TableRow key={check.id}>
              <TableCell className="whitespace-nowrap tabular text-muted-foreground">
                {formatRelativeTime(check.checkedAt)}
              </TableCell>
              <TableCell className="max-w-[16rem] truncate">
                <Link
                  to={`/monitors/${check.monitorId}`}
                  className="text-foreground underline-offset-4 hover:underline"
                >
                  {check.monitorName}
                </Link>
              </TableCell>
              <TableCell>
                {check.success ? (
                  <Badge variant="outline" className="border-healthy/25 bg-healthy/10 text-healthy">
                    Met
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-down/25 bg-down/10 text-down">
                    Failed
                  </Badge>
                )}
              </TableCell>
              <TableCell className="tabular">{formatStatusCode(check.httpStatusCode)}</TableCell>
              <TableCell className="text-right tabular">
                {formatDurationMs(check.responseTimeMs)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
