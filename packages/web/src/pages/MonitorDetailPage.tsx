import {
  METHODS_WITH_BODY,
  TIME_WINDOWS,
  TIME_WINDOW_LABELS,
  TIME_WINDOW_MS,
  type TimeWindow,
} from '@pulsecheck/shared';
import { ArrowLeft, ExternalLink, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  useCheckResults,
  useMonitorIncidents,
  useMonitorResponseTimes,
  useMonitorUptime,
} from '@/api/history';
import { useDeleteMonitor, useMonitor, usePauseMonitor, useResumeMonitor } from '@/api/monitors';
import { CheckResultsTable } from '@/components/CheckResultsTable';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ErrorState } from '@/components/ErrorState';
import { IncidentList } from '@/components/IncidentList';
import { PageHeader } from '@/components/PageHeader';
import { ResponseTimeChart } from '@/components/ResponseTimeChart';
import { StatCard } from '@/components/StatCard';
import { StatusBadge } from '@/components/StatusBadge';
import { UptimeBar } from '@/components/UptimeBar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api-client';
import {
  formatDateTime,
  formatDurationMs,
  formatInterval,
  formatNumber,
  formatPercent,
  formatRelativeTime,
} from '@/lib/format';

const CHECK_PAGE_SIZE = 25;
const INCIDENT_PAGE_SIZE = 10;

type SuccessFilter = 'all' | 'success' | 'failed';

function parseSuccessFilter(value: string | undefined): SuccessFilter {
  return value === 'success' || value === 'failed' ? value : 'all';
}

export function MonitorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [window, setWindow] = React.useState<TimeWindow>('24h');
  const [checkPage, setCheckPage] = React.useState(1);
  const [successFilter, setSuccessFilter] = React.useState<SuccessFilter>('all');
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const monitorQuery = useMonitor(id);
  const uptimeQuery = useMonitorUptime(id, window);
  const responseTimesQuery = useMonitorResponseTimes(id, window);
  const checksQuery = useCheckResults(id, {
    page: checkPage,
    pageSize: CHECK_PAGE_SIZE,
    success: successFilter === 'all' ? undefined : successFilter === 'success',
  });
  const incidentsQuery = useMonitorIncidents(id, {
    page: 1,
    pageSize: INCIDENT_PAGE_SIZE,
    status: 'all',
  });

  const pause = usePauseMonitor();
  const resume = useResumeMonitor();
  const remove = useDeleteMonitor();

  const monitor = monitorQuery.data;

  const notFound =
    monitorQuery.error instanceof ApiError && monitorQuery.error.code === 'NOT_FOUND';

  if (monitorQuery.isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (notFound || (!monitorQuery.isLoading && !monitor && monitorQuery.isError)) {
    return (
      <div className="space-y-4">
        <ErrorState
          error={monitorQuery.error}
          title={notFound ? 'Monitor not found' : 'Could not load this monitor'}
          onRetry={() => {
            void monitorQuery.refetch();
          }}
        />
        <Button variant="outline" asChild>
          <Link to="/monitors">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to monitors
          </Link>
        </Button>
      </div>
    );
  }

  if (!monitor) return null;

  const stats = uptimeQuery.data?.stats;
  const windowLabel = TIME_WINDOW_LABELS[window];
  // The number of checks a window can hold, used to explain an empty window.
  const expectedChecks = Math.max(
    1,
    Math.floor(TIME_WINDOW_MS[window] / 1000 / monitor.intervalSeconds),
  );

  const handlePauseToggle = () => {
    const mutation = monitor.enabled ? pause : resume;
    mutation.mutate(monitor.id, {
      onSuccess: () => toast.success(monitor.enabled ? 'Monitor paused' : 'Monitor resumed'),
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : 'Could not update the monitor'),
    });
  };

  const handleDelete = () => {
    remove.mutate(monitor.id, {
      onSuccess: () => {
        toast.success(`Deleted ${monitor.name}`);
        navigate('/monitors');
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : 'Could not delete the monitor');
        setConfirmDelete(false);
      },
    });
  };

  return (
    <div className="space-y-6">
      <Link
        to="/monitors"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Monitors
      </Link>

      <PageHeader
        title={monitor.name}
        eyebrow={
          <span className="flex flex-wrap items-center gap-3">
            <a
              href={monitor.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 font-mono text-xs underline-offset-4 hover:text-foreground hover:underline"
            >
              {monitor.url}
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
            <span className="text-muted-foreground">
              {monitor.method} · every {formatInterval(monitor.intervalSeconds)} · timeout{' '}
              {formatDurationMs(monitor.timeoutMs)}
            </span>
          </span>
        }
        description={`Last checked ${
          monitor.lastCheckedAt ? formatRelativeTime(monitor.lastCheckedAt) : 'never'
        } · next check ${formatRelativeTime(monitor.nextCheckAt)}`}
        actions={
          <>
            <StatusBadge status={monitor.status} />
            <Button
              variant="outline"
              size="sm"
              onClick={handlePauseToggle}
              disabled={pause.isPending || resume.isPending}
            >
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
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/monitors/${monitor.id}/edit`}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Edit
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Delete
            </Button>
          </>
        }
      />

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Performance · {windowLabel}</h2>
        <Select value={window} onValueChange={(value) => setWindow(value as TimeWindow)}>
          <SelectTrigger className="w-40" aria-label="Time window">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIME_WINDOWS.map((option) => (
              <SelectItem key={option} value={option}>
                {TIME_WINDOW_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {uptimeQuery.isError ? (
        <ErrorState
          error={uptimeQuery.error}
          title="Could not load uptime statistics"
          onRetry={() => {
            void uptimeQuery.refetch();
          }}
        />
      ) : (
        <Card>
          <CardContent className="space-y-4 p-5 pt-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatCard
                label="Uptime"
                value={
                  uptimeQuery.isLoading && !stats ? (
                    <Skeleton className="h-7 w-16" />
                  ) : (
                    formatPercent(stats?.uptimePercent ?? null)
                  )
                }
                hint={
                  stats && stats.totalChecks > 0
                    ? `${formatNumber(stats.successfulChecks)} of ${formatNumber(stats.totalChecks)} checks met expectations`
                    : 'No data yet'
                }
                loading={false}
              />
              <StatCard
                label="Availability"
                value={formatPercent(stats?.availabilityPercent ?? null)}
                hint="Received any HTTP response"
              />
              <StatCard
                label="Avg response"
                value={formatDurationMs(stats?.avgResponseTimeMs ?? null)}
              />
              <StatCard
                label="p95 response"
                value={formatDurationMs(stats?.p95ResponseTimeMs ?? null)}
              />
              <StatCard
                label="Checks"
                value={formatNumber(stats?.totalChecks ?? null)}
                hint={`Failed: ${formatNumber(stats?.failedChecks ?? null)}`}
              />
            </div>
            {stats ? <UptimeBar stats={stats} /> : <Skeleton className="h-6 w-full" />}
            {stats && stats.totalChecks === 0 ? (
              <p className="text-xs text-muted-foreground">
                This window is empty. At a {formatInterval(monitor.intervalSeconds)} interval it can
                hold about {formatNumber(expectedChecks)} checks.
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Response time · {windowLabel}</CardTitle>
          <p className="text-xs text-muted-foreground">
            Average per bucket, with p95 as a dashed line. Gaps mean no checks were recorded in that
            bucket.
          </p>
        </CardHeader>
        <CardContent>
          {responseTimesQuery.isError ? (
            <ErrorState
              error={responseTimesQuery.error}
              title="Could not load response times"
              onRetry={() => {
                void responseTimesQuery.refetch();
              }}
            />
          ) : (
            <ResponseTimeChart
              points={responseTimesQuery.data?.points ?? []}
              window={window}
              loading={responseTimesQuery.isLoading}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Check results</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Every stored check, newest first.</p>
          </div>
          <Select
            value={successFilter}
            onValueChange={(value) => {
              setSuccessFilter(parseSuccessFilter(value));
              setCheckPage(1);
            }}
          >
            <SelectTrigger className="w-40" aria-label="Filter check results">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All results</SelectItem>
              <SelectItem value="success">Met expectations</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {checksQuery.isError ? (
            <ErrorState
              error={checksQuery.error}
              title="Could not load check results"
              onRetry={() => {
                void checksQuery.refetch();
              }}
            />
          ) : (
            <CheckResultsTable
              page={checksQuery.data}
              loading={checksQuery.isLoading || checksQuery.isFetching}
              onPageChange={setCheckPage}
              emptyTitle={
                successFilter === 'all' ? 'No checks recorded yet' : 'No checks match this filter'
              }
              emptyDescription={
                successFilter === 'all'
                  ? 'The first result appears once the scheduler runs this monitor.'
                  : 'Try a different result filter.'
              }
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Incidents</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Opened when this monitor stopped meeting expectations.
            </p>
          </div>
          <Link
            to="/incidents"
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            All incidents
          </Link>
        </CardHeader>
        <CardContent>
          {incidentsQuery.isError ? (
            <ErrorState
              error={incidentsQuery.error}
              title="Could not load incidents"
              onRetry={() => {
                void incidentsQuery.refetch();
              }}
            />
          ) : (
            <IncidentList
              incidents={incidentsQuery.data?.items}
              loading={incidentsQuery.isLoading}
              hideMonitor
              emptyDescription="This monitor has not had a failure that opened an incident."
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Method</dt>
              <dd className="font-mono">{monitor.method}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Interval</dt>
              <dd className="tabular">{formatInterval(monitor.intervalSeconds)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Timeout</dt>
              <dd className="tabular">{formatDurationMs(monitor.timeoutMs)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Expected status
              </dt>
              <dd className="tabular">
                {monitor.expectedStatusMin}–{monitor.expectedStatusMax}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Degraded threshold
              </dt>
              <dd className="tabular">
                {monitor.degradedResponseTimeMs === null
                  ? '—'
                  : formatDurationMs(monitor.degradedResponseTimeMs)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Monitoring</dt>
              <dd>{monitor.enabled ? 'Enabled' : 'Paused'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Consecutive failures
              </dt>
              <dd className="tabular">{formatNumber(monitor.consecutiveFailures)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Last status change
              </dt>
              <dd className="tabular">{formatDateTime(monitor.lastStatusChangeAt)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Created</dt>
              <dd className="tabular">{formatDateTime(monitor.createdAt)}</dd>
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Custom headers
              </dt>
              <dd className="mt-1">
                {Object.keys(monitor.headers).length === 0 ? (
                  <span className="text-muted-foreground">None</span>
                ) : (
                  <ul className="space-y-1 font-mono text-xs">
                    {Object.entries(monitor.headers).map(([name, value]) => (
                      <li key={name} className="truncate">
                        <span className="text-foreground">{name}</span>
                        <span className="text-muted-foreground">: {value}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
            {monitor.body && METHODS_WITH_BODY.includes(monitor.method) ? (
              <div className="sm:col-span-2 lg:col-span-3">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Request body
                </dt>
                <dd className="mt-1">
                  <pre className="max-h-40 overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs">
                    {monitor.body}
                  </pre>
                </dd>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete monitor"
        description={
          <>
            <span className="font-medium text-foreground">{monitor.name}</span> and all of its check
            history and incidents will be permanently removed. This cannot be undone.
          </>
        }
        confirmLabel="Delete monitor"
        loading={remove.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
