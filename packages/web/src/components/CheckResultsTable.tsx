import type { CheckResultDto, Page } from '@pulsecheck/shared';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { errorCategoryLabel } from '@/lib/status';
import { formatDateTime, formatDurationMs, formatStatusCode } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface CheckResultsTableProps {
  page: Page<CheckResultDto> | undefined;
  loading?: boolean;
  onPageChange: (page: number) => void;
  /** Adds a "Monitor" column for account-wide activity tables. */
  monitorNames?: Record<string, string>;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}

/** Individual check results: status code, duration, failure reason, timestamp. */
export function CheckResultsTable({
  page,
  loading = false,
  onPageChange,
  monitorNames,
  emptyTitle = 'No checks recorded yet',
  emptyDescription = 'Results appear here after the first scheduled check completes.',
  className,
}: CheckResultsTableProps) {
  if (loading && !page) {
    return (
      <div className={cn('space-y-2', className)} aria-busy="true">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (!page || page.items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} className={className} />;
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Checked at</TableHead>
              <TableHead>Result</TableHead>
              {monitorNames ? <TableHead>Monitor</TableHead> : null}
              <TableHead>HTTP</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead>Failure reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.items.map((check) => (
              <TableRow key={check.id}>
                <TableCell className="whitespace-nowrap tabular text-muted-foreground">
                  {formatDateTime(check.checkedAt)}
                </TableCell>
                <TableCell>
                  {check.success ? (
                    <Badge
                      variant="outline"
                      className="border-healthy/25 bg-healthy/10 text-healthy"
                    >
                      Met expectations
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-down/25 bg-down/10 text-down">
                      Failed
                    </Badge>
                  )}
                </TableCell>
                {monitorNames ? (
                  <TableCell>
                    <Link
                      to={`/monitors/${check.monitorId}`}
                      className="text-foreground underline-offset-4 hover:underline"
                    >
                      {monitorNames[check.monitorId] ?? 'Monitor'}
                    </Link>
                  </TableCell>
                ) : null}
                <TableCell className="tabular">{formatStatusCode(check.httpStatusCode)}</TableCell>
                <TableCell className="text-right tabular">
                  {formatDurationMs(check.responseTimeMs)}
                </TableCell>
                <TableCell className="max-w-[22rem] text-muted-foreground">
                  {check.errorCategory ? (
                    <span title={check.errorMessage ?? undefined}>
                      {errorCategoryLabel(check.errorCategory)}
                      {check.errorMessage ? `: ${check.errorMessage}` : ''}
                    </span>
                  ) : (
                    '—'
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <p className="tabular">
          Page {page.page} of {Math.max(1, page.totalPages)} · {page.total} total
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page.page <= 1 || loading}
            onClick={() => onPageChange(Math.max(1, page.page - 1))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!page.hasMore || loading}
            onClick={() => onPageChange(page.page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
      <span className="sr-only" aria-live="polite">
        Showing page {page.page} of {Math.max(1, page.totalPages)}, {page.items.length} of{' '}
        {page.total} checks
      </span>
    </div>
  );
}
