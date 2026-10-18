import { Inbox } from 'lucide-react';
import type * as React from 'react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** Primary call to action. An empty state without a next step is a dead end. */
  action?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
}

export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  const Icon = icon ?? Inbox;
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/40 px-6 py-12 text-center',
        className,
      )}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="h-5 w-5" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
