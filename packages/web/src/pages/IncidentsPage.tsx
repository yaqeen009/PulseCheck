import * as React from 'react';
import { useIncidents } from '@/api/history';
import type { IncidentFilter } from '@/api/query-keys';
import { ErrorState } from '@/components/ErrorState';
import { IncidentList } from '@/components/IncidentList';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const INCIDENT_PAGE_SIZE = 20;

const FILTERS: ReadonlyArray<{ value: IncidentFilter; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
];

export function IncidentsPage() {
  const [status, setStatus] = React.useState<IncidentFilter>('open');
  const [page, setPage] = React.useState(1);

  const incidentsQuery = useIncidents({ page, pageSize: INCIDENT_PAGE_SIZE, status });
  const data = incidentsQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Incidents"
        description="Every outage and degradation PulseCheck recorded, with how long it lasted."
      />

      <Tabs
        value={status}
        onValueChange={(value) => {
          setStatus(value as IncidentFilter);
          setPage(1);
        }}
      >
        <TabsList aria-label="Incident status filter">
          {FILTERS.map((filter) => (
            <TabsTrigger key={filter.value} value={filter.value}>
              {filter.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {incidentsQuery.isError ? (
        <ErrorState
          error={incidentsQuery.error}
          title="Could not load incidents"
          onRetry={() => {
            void incidentsQuery.refetch();
          }}
        />
      ) : (
        <Card>
          <CardContent className="space-y-4 p-4 pt-4">
            <IncidentList
              incidents={data?.items}
              loading={incidentsQuery.isLoading}
              emptyTitle={
                status === 'open'
                  ? 'No open incidents'
                  : status === 'resolved'
                    ? 'No resolved incidents yet'
                    : 'No incidents recorded'
              }
              emptyDescription={
                status === 'open'
                  ? 'Every monitor is meeting its expectations right now.'
                  : 'Incidents appear here after a monitor stops meeting its expectations.'
              }
            />

            {data && data.total > 0 ? (
              <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                <p className="tabular">
                  Page {data.page} of {Math.max(1, data.totalPages)} · {data.total} incidents
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1 || incidentsQuery.isFetching}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!data.hasMore || incidentsQuery.isFetching}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
