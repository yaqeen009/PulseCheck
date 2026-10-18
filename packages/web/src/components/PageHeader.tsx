import type * as React from 'react';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /** Small line above the title, e.g. a breadcrumb or the monitor URL. */
  eyebrow?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, eyebrow, className }: PageHeaderProps) {
  return (
    <div
      className={cn('flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between', className)}
    >
      <div className="space-y-1.5">
        {eyebrow ? <div className="text-xs text-muted-foreground">{eyebrow}</div> : null}
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? (
          <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
