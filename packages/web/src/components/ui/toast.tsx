import type * as React from 'react';
import { Toaster as SonnerToaster } from 'sonner';

type ToasterProps = React.ComponentProps<typeof SonnerToaster>;

/**
 * Toast surface. Sonner owns the queue and the accessibility announcements; this
 * wrapper only binds it to the app's design tokens.
 */
function Toaster({ ...props }: ToasterProps) {
  return (
    <SonnerToaster
      theme="dark"
      position="bottom-right"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
          error: 'group-[.toaster]:border-destructive/40',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
