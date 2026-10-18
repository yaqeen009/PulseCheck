import type { MonitorStatus } from '@pulsecheck/shared';
import { cn } from '@/lib/utils';
import { statusPresentation } from '@/lib/status';

export interface StatusDotProps {
  status: MonitorStatus;
  className?: string;
  /** Animate only for an actively failing monitor; a static dot for the rest. */
  pulse?: boolean;
}

/** Compact status indicator: colour first, text second. */
export function StatusDot({ status, className, pulse }: StatusDotProps) {
  const presentation = statusPresentation(status);
  const shouldPulse = pulse ?? status === 'DOWN';
  return (
    <span
      className={cn(
        'relative inline-flex h-2 w-2 shrink-0 rounded-full',
        presentation.dotClass,
        className,
      )}
      role="img"
      aria-label={presentation.label}
      title={presentation.label}
    >
      {shouldPulse ? (
        <span
          className={cn(
            'absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:animate-none',
            presentation.dotClass,
          )}
          aria-hidden="true"
        />
      ) : null}
    </span>
  );
}
