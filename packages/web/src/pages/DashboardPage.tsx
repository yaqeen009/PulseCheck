import { TIME_WINDOWS, TIME_WINDOW_LABELS, type TimeWindow } from '@pulsecheck/shared';
import { Activity, Plus, ShieldAlert } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import { useDashboardActivity, useDashboardSummary } from '@/api/dashboard';
import { useAggregateUptime } from '@/api/history';
import { useMonitors } from '@/api/monitors';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { IncidentList } from '@/components/IncidentList';
import { PageHeader } from '@/components/PageHeader';
import { RecentChecksList } from '@/components/RecentChecksList';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDurationMs, formatNumber, formatPercent, formatRelativeTime } from '@/lib/format';

function StatGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-busy="true">
      {Array.from({ length: 6 }).map((_, index) => (
        <Skeleton key={index} className="h-[92px] w-full" />
      ))}
    </div>
  );
}

export function DashboardPage() {
  const summaryQuery = useDashboardSummary();
  const activityQuery = useDashboardActivity();
  const monitorsQuery = useMonitors({ status: 'ALL', sort: 'name', order: 'asc' });
  const [window, setWindow] = React.useState<TimeWindow>('24h');

  const monitorIds = React.useMemo(
    () => (monitorsQuery.data ?? []).map((monitor) => monitor.id),
    [monitorsQuery.data],
  );
  const aggregate = useAggregateUptime(monitorIds, window);

  const summary = summaryQuery.data;
  const total = summary?.monitors.total ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Current health of every monitor, plus the newest checks and incidents."
        actions={
          <Button asChild size="sm">
            <Link to="/monitors/new">
              <Plus className="h-4 w-4" aria-hidden="true" />
              New monitor
            </Link>
          </Button>
        }
      />

      {summaryQuery.isError ? (
        <ErrorState
          error={summaryQuery.error}
          title="Could not load the dashboard summary"
          onRetry={() => {
            void summaryQuery.refetch();
          }}
        />
      ) : null}

      {summaryQuery.isLoading ? <StatGridSkeleton /> : null}

      {summary ? (
        <>
          {total === 0 ? (
            <EmptyState
              icon={Activity}
              title="No monitors yet"
              description="PulseCheck has nothing to report until a monitor exists. Create one and the first check results will appear here."
              action={
                <Button asChild>
                  <Link to="/monitors/new">
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Create your first monitor
                  </Link>
                </Button>
              }
            />
          ) : null}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Total" value={formatNumber(summary.monitors.total)} />
            <StatCard
              label="Healthy"
              value={formatNumber(summary.monitors.healthy)}
              valueClassName="text-healthy"
            />
            <StatCard
              label="Degraded"
              value={formatNumber(summary.monitors.degraded)}
              valueClassName="text-degraded"
            />
            <StatCard
              label="Down"
              value={formatNumber(summary.monitors.down)}
              valueClassName="text-down"
            />
            <StatCard
              label="Paused"
              value={formatNumber(summary.monitors.paused)}
              valueClassName="text-paused"
            />
            <StatCard
              label="Pending"
              value={formatNumber(summary.monitors.pending)}
              valueClassName="text-pending"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Open incidents"
              value={formatNumber(summary.openIncidents)}
              icon={ShieldAlert}
              hint={
                summary.openIncidents === 0
                  ? 'Nothing is failing right now'
                  : 'Monitors are failing'
              }
            />
            <StatCard
              label="Incidents · 24h"
              value={formatNumber(summary.incidentsLast24h)}
              hint="Opened in the last 24 hours"
            />
            <StatCard
              label="Checks · 24h"
              value={formatNumber(summary.checksLast24h.total)}
              hint={`${formatNumber(summary.checksLast24h.failed)} failed`}
            />
            <StatCard
              label="Check success rate · 24h"
              value={formatPercent(summary.checksLast24h.successRatePercent, 1)}
              hint={
                summary.checksLast24h.successRatePercent === null
                  ? 'No checks in the last 24 hours'
                  : 'Checks that met expectations'
              }
              valueClassName={
                summary.checksLast24h.successRatePercent === null ? undefined : 'text-foreground'
              }
            />
          </div>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Aggregate uptime</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Combined across all monitors, computed per monitor by the API.
                </p>
              </div>
              <Select value={window} onValueChange={(value) => setWindow(value as TimeWindow)}>
                <SelectTrigger className="w-40" aria-label="Uptime window">
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
            </CardHeader>
            <CardContent className="space-y-4">
              {aggregate.isError ? (
                <ErrorState
                  error={aggregate.error}
                  title="Could not load uptime for this window"
                  onRetry={() => {
                    void monitorsQuery.refetch();
                  }}
                />
              ) : aggregate.isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <StatCard
                      label="Uptime"
                      value={formatPercent(aggregate.stats.uptimePercent)}
                      hint={
                        aggregate.stats.totalChecks === 0
                          ? 'No checks in this window'
                          : `${formatNumber(aggregate.loadedMonitors)} of ${formatNumber(
                              aggregate.totalMonitors,
                            )} monitors reported`
                      }
                    />
                    <StatCard
                      label="Availability"
                      value={formatPercent(aggregate.stats.availabilityPercent)}
                      hint="Checks that received any HTTP response"
                    />
                    <StatCard
                      label="Avg response"
                      value={formatDurationMs(aggregate.stats.avgResponseTimeMs)}
                    />
                    <StatCard
                      label="p95 response"
                      value={formatDurationMs(aggregate.stats.p95ResponseTimeMs)}
                    />
                  </div>
                  <UptimeBar stats={aggregate.stats} />
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Slowest monitors</CardTitle>
              <p className="text-xs text-muted-foreground">
                Ranked by average response time in the summary window.
              </p>
            </CardHeader>
            <CardContent>
              {summary.slowestMonitors.length === 0 ? (
                <EmptyState
                  title="No response-time data yet"
                  description="Once checks have completed, the slowest endpoints are listed here."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Monitor</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Avg response</TableHead>
                      <TableHead className="text-right">Uptime</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.slowestMonitors.map((monitor) => (
                      <TableRow key={monitor.monitorId}>
                        <TableCell className="max-w-[18rem] truncate">
                          <Link
                            to={`/monitors/${monitor.monitorId}`}
                            className="font-medium text-foreground underline-offset-4 hover:underline"
                          >
                            {monitor.name}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={monitor.status} />
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {formatDurationMs(monitor.avgResponseTimeMs)}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {formatPercent(monitor.uptimePercent)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Recent checks</CardTitle>
            <Link
              to="/monitors"
              className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              All monitors
            </Link>
          </CardHeader>
          <CardContent>
            {activityQuery.isError ? (
              <ErrorState
                error={activityQuery.error}
                title="Could not load recent checks"
                onRetry={() => {
                  void activityQuery.refetch();
                }}
              />
            ) : (
              <RecentChecksList
                checks={activityQuery.data?.recentChecks}
                loading={activityQuery.isLoading}
                emptyDescription={
                  total === 0
                    ? 'Create a monitor to start collecting check results.'
                    : 'Checks appear here as soon as they complete.'
                }
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Recent incidents</CardTitle>
            <Link
              to="/incidents"
              className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              Incident history
            </Link>
          </CardHeader>
          <CardContent>
            {activityQuery.isError ? (
              <ErrorState
                error={activityQuery.error}
                title="Could not load recent incidents"
                onRetry={() => {
                  void activityQuery.refetch();
                }}
              />
            ) : (
              <IncidentList
                incidents={activityQuery.data?.recentIncidents}
                loading={activityQuery.isLoading}
                emptyDescription={
                  total === 0
                    ? 'Incidents are recorded once monitors start failing.'
                    : 'Monitors have not opened an incident recently.'
                }
              />
            )}
          </CardContent>
        </Card>
      </div>

      {monitorsQuery.data && monitorsQuery.data.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Last updated {formatRelativeTime(summaryQuery.dataUpdatedAt || null)} · refreshes every 30
          seconds
        </p>
      ) : null}
    </div>
  );
}
