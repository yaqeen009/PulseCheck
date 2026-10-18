import type { ValidationIssue } from '@pulsecheck/shared';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { usePlatformMeta } from '@/api/meta';
import { useCreateMonitor } from '@/api/monitors';
import { ErrorState } from '@/components/ErrorState';
import { MonitorForm, type MonitorPayload } from '@/components/MonitorForm';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api-client';

export function MonitorNewPage() {
  const meta = usePlatformMeta();
  const createMonitor = useCreateMonitor();
  const navigate = useNavigate();
  const [serverIssues, setServerIssues] = React.useState<ValidationIssue[]>([]);

  const handleSubmit = (payload: MonitorPayload) => {
    setServerIssues([]);
    createMonitor.mutate(payload, {
      onSuccess: (response) => {
        toast.success('Monitor created');
        navigate(`/monitors/${response.monitor.id}`);
      },
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'VALIDATION_ERROR') {
          setServerIssues(error.validationIssues);
          toast.error('The server rejected some fields');
          return;
        }
        toast.error(error instanceof Error ? error.message : 'Could not create the monitor');
      },
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="New monitor"
        description="PulseCheck checks the target on the interval you choose and records every result."
      />

      {meta.isLoading ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : meta.isError || !meta.data ? (
        <ErrorState
          error={meta.error}
          title="Could not load the platform limits"
          onRetry={() => {
            void meta.refetch();
          }}
        />
      ) : (
        <MonitorForm
          mode="create"
          limits={meta.data.limits}
          submitting={createMonitor.isPending}
          serverIssues={serverIssues}
          onSubmit={handleSubmit}
          onCancel={() => navigate('/monitors')}
        />
      )}
    </div>
  );
}
