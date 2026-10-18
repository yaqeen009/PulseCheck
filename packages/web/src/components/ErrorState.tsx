import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

export interface ErrorStateProps {
  error: unknown;
  title?: string;
  onRetry?: () => void;
  className?: string;
}

function describe(error: unknown): { message: string; requestId?: string } {
  if (error instanceof ApiError) {
    return { message: error.message, requestId: error.requestId };
  }
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: 'Something went wrong.' };
}

/** Failure surface. Shows the server's message and request id for support. */
export function ErrorState({
  error,
  title = 'Could not load this data',
  onRetry,
  className,
}: ErrorStateProps) {
  const { message, requestId } = describe(error);
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-5',
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground">{message}</p>
          {requestId ? (
            <p className="font-mono text-2xs text-muted-foreground">Request {requestId}</p>
          ) : null}
        </div>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
