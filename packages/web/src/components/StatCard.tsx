import type * as React from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface StatCardProps {
  label: string;
  /** Pre-formatted value. Pass `null` for "no data" instead of a fake zero. */
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  /** Accent colour for the value, usually a status text class. */
  valueClassName?: string;
  loading?: boolean;
  className?: string;
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  valueClassName,
  loading = false,
  className,
}: StatCardProps) {
  return (
    <Card className={cn('p-4', className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {Icon ? <Icon className="h-4 w-4 text-muted-foreground" /> : null}
      </div>
      <div className="mt-2">
        {loading ? (
          <Skeleton className="h-7 w-16" />
        ) : (
          <p
            className={cn(
              'tabular text-2xl font-semibold tracking-tight text-foreground',
              valueClassName,
            )}
          >
            {value}
          </p>
        )}
      </div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </Card>
  );
}
