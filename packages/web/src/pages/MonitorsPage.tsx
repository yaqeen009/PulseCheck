import type { MonitorDto, MonitorStatus } from '@pulsecheck/shared';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useMonitorUptimeMap } from '@/api/history';
import { useDeleteMonitor, useMonitors, usePauseMonitor, useResumeMonitor } from '@/api/monitors';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { StatusDot } from '@/components/StatusDot';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { STATUS_FILTER_OPTIONS } from '@/lib/status';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { formatInterval, formatPercent, formatRelativeTime } from '@/lib/format';

type SortField = 'name' | 'status' | 'lastCheckedAt' | 'createdAt';
type SortOrder = 'asc' | 'desc';

export function MonitorsPage() {
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState<MonitorStatus | 'ALL'>('ALL');
  const [sort, setSort] = React.useState<SortField>('createdAt');
  const [order, setOrder] = React.useState<SortOrder>('desc');
  const [pendingDelete, setPendingDelete] = React.useState<MonitorDto | null>(null);

  const debouncedSearch = useDebouncedValue(search, 300);

  const monitorsQuery = useMonitors({
    search: debouncedSearch.trim() === '' ? undefined : debouncedSearch.trim(),
    status,
    sort,
    order,
  });

  const monitors = monitorsQuery.data;

  const monitorIds = React.useMemo(() => (monitors ?? []).map((monitor) => monitor.id), [monitors]);
  const uptime = useMonitorUptimeMap(monitorIds, '24h');

  const pause = usePauseMonitor();
  const resume = useResumeMonitor();
  const remove = useDeleteMonitor();

  const toggleSort = (field: SortField) => {
    if (sort === field) {
      setOrder(order === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSort(field);
    setOrder('asc');
  };

  const sortIcon = (field: SortField) => {
    if (sort !== field) return <ArrowUpDown className="h-3 w-3" aria-hidden="true" />;
    return order === 'asc' ? (
      <ArrowUp className="h-3 w-3" aria-hidden="true" />
    ) : (
      <ArrowDown className="h-3 w-3" aria-hidden="true" />
    );
  };

  const handlePauseToggle = (monitor: MonitorDto) => {
    const mutation = monitor.enabled ? pause : resume;
    mutation.mutate(monitor.id, {
      onSuccess: () => toast.success(monitor.enabled ? 'Monitor paused' : 'Monitor resumed'),
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : 'Could not update the monitor'),
    });
  };

  const handleDelete = () => {
    if (!pendingDelete) return;
    remove.mutate(pendingDelete.id, {
      onSuccess: () => {
        toast.success(`Deleted ${pendingDelete.name}`);
        setPendingDelete(null);
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : 'Could not delete the monitor');
        setPendingDelete(null);
      },
    });
  };

  const isFiltered = debouncedSearch.trim() !== '' || status !== 'ALL';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Monitors"
        description="Every endpoint PulseCheck checks, with its current status and recent uptime."
        actions={
          <Button asChild size="sm">
            <Link to="/monitors/new">
              <Plus className="h-4 w-4" aria-hidden="true" />
              New monitor
            </Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name or URL"
            aria-label="Search monitors"
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={(value) => setStatus(value as MonitorStatus | 'ALL')}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {monitorsQuery.isError ? (
        <ErrorState
          error={monitorsQuery.error}
          title="Could not load monitors"
          onRetry={() => {
            void monitorsQuery.refetch();
          }}
        />
      ) : null}

      {monitorsQuery.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      ) : null}

      {monitors && monitors.length === 0 ? (
        isFiltered ? (
          <EmptyState
            title="No monitors match those filters"
            description="Try a different search term or clear the status filter."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setSearch('');
                  setStatus('ALL');
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No monitors yet"
            description="Add the first endpoint you want to keep an eye on. PulseCheck will check it on a schedule and record every result."
            action={
              <Button asChild>
                <Link to="/monitors/new">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Create your first monitor
                </Link>
              </Button>
            }
          />
        )
      ) : null}

      {monitors && monitors.length > 0 ? (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <button
                    type="button"
                    onClick={() => toggleSort('name')}
                    className="inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-foreground"
                  >
                    Monitor
                    {sortIcon('name')}
                  </button>
                </TableHead>
                <TableHead>
                  <button
                    type="button"
                    onClick={() => toggleSort('status')}
                    className="inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-foreground"
                  >
                    Status
                    {sortIcon('status')}
                  </button>
                </TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Interval</TableHead>
                <TableHead>
                  <button
                    type="button"
                    onClick={() => toggleSort('lastCheckedAt')}
                    className="inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-foreground"
                  >
                    Last checked
                    {sortIcon('lastCheckedAt')}
                  </button>
                </TableHead>
                <TableHead className="text-right">Uptime · 24h</TableHead>
                <TableHead className="w-12 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {monitors.map((monitor) => {
                const stats = uptime.statsByMonitor.get(monitor.id);
                return (
                  <TableRow key={monitor.id}>
                    <TableCell>
                      <div className="flex items-start gap-2">
                        <span className="pt-1.5">
                          <StatusDot status={monitor.status} />
                        </span>
                        <div className="min-w-0">
                          <Link
                            to={`/monitors/${monitor.id}`}
                            className="font-medium text-foreground underline-offset-4 hover:underline"
                          >
                            {monitor.name}
                          </Link>
                          <p className="max-w-[22rem] truncate font-mono text-2xs text-muted-foreground">
                            {monitor.url}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={monitor.status} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{monitor.method}</TableCell>
                    <TableCell className="tabular text-muted-foreground">
                      {formatInterval(monitor.intervalSeconds)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {monitor.lastCheckedAt ? formatRelativeTime(monitor.lastCheckedAt) : 'Never'}
                    </TableCell>
                    <TableCell className="text-right tabular">
                      {uptime.isLoading && !stats ? (
                        <Skeleton className="ml-auto h-4 w-12" />
                      ) : (
                        formatPercent(stats?.uptimePercent ?? null)
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Actions for ${monitor.name}`}
                          >
                            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link to={`/monitors/${monitor.id}`}>Open</Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link to={`/monitors/${monitor.id}/edit`}>
                              <Pencil className="h-4 w-4" aria-hidden="true" />
                              Edit
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => handlePauseToggle(monitor)}>
                            {monitor.enabled ? (
                              <>
                                <Pause className="h-4 w-4" aria-hidden="true" />
                                Pause
                              </>
                            ) : (
                              <>
                                <Play className="h-4 w-4" aria-hidden="true" />
                                Resume
                              </>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => setPendingDelete(monitor)}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete monitor"
        description={
          <>
            <span className="font-medium text-foreground">{pendingDelete?.name}</span> and its check
            history will be permanently removed. This cannot be undone.
          </>
        }
        confirmLabel="Delete monitor"
        loading={remove.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
