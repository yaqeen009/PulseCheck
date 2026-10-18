import type { ValidationIssue } from '@pulsecheck/shared';
import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { usePlatformMeta } from '@/api/meta';
import { useMonitor, useUpdateMonitor } from '@/api/monitors';
import { ErrorState } from '@/components/ErrorState';
import { MonitorForm, type MonitorPayload } from '@/components/MonitorForm';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api-client';

export function MonitorEditPage() {
  const { id } = useParams<{ id: string }>();
  const meta = usePlatformMeta();
  const monitorQuery = useMonitor(id);
  const updateMonitor = useUpdateMonitor();
  const navigate = useNavigate();
  const [serverIssues, setServerIssues] = React.useState<ValidationIssue[]>([]);

  const handleSubmit = (payload: MonitorPayload) => {
    if (!id) return;
    setServerIssues([]);
    updateMonitor.mutate(
      { id, payload },
      {
        onSuccess: () => {
          toast.success('Monitor updated');
          navigate(`/monitors/${id}`);
        },
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'VALIDATION_ERROR') {
            setServerIssues(error.validationIssues);
            toast.error('The server rejected some fields');
            return;
          }
          toast.error(error instanceof Error ? error.message : 'Could not update the monitor');
        },
      },
    );
  };

  const loading = meta.isLoading || monitorQuery.isLoading;
  const failed = meta.isError || monitorQuery.isError;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Edit monitor"
        description="Changes apply to the next scheduled check."
        eyebrow={monitorQuery.data ? monitorQuery.data.name : undefined}
      />

      {loading ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : failed ? (
        <ErrorState
          error={meta.error ?? monitorQuery.error}
          title="Could not load this monitor"
          onRetry={() => {
            void monitorQuery.refetch();
            void meta.refetch();
          }}
        />
      ) : monitorQuery.data && meta.data ? (
        <MonitorForm
          mode="edit"
          limits={meta.data.limits}
          monitor={monitorQuery.data}
          submitting={updateMonitor.isPending}
          serverIssues={serverIssues}
          onSubmit={handleSubmit}
          onCancel={() => navigate(`/monitors/${monitorQuery.data.id}`)}
        />
      ) : null}
    </div>
  );
}
