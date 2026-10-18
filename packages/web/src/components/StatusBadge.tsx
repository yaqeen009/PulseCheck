import type { MonitorStatus } from '@pulsecheck/shared';
import { Badge } from '@/components/ui/badge';
import { statusPresentation } from '@/lib/status';
import { cn } from '@/lib/utils';

export interface StatusBadgeProps {
  status: MonitorStatus;
  className?: string;
  /** Hide the leading dot (used in dense tables). */
  hideIcon?: boolean;
}

/** Status pill: colour + icon + label, so status never depends on colour alone. */
export function StatusBadge({ status, className, hideIcon = false }: StatusBadgeProps) {
  const presentation = statusPresentation(status);
  const Icon = presentation.icon;
  return (
    <Badge
      variant="outline"
      className={cn('gap-1.5 font-medium', presentation.badgeClass, className)}
      data-status={status}
    >
      {hideIcon ? null : <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      {presentation.label}
    </Badge>
  );
}
