import { zodResolver } from '@hookform/resolvers/zod';
import { DEFAULT_LIMITS, createLoginSchema, type PlatformLimits } from '@pulsecheck/shared';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { usePlatformMeta } from '@/api/meta';
import { useLogin } from '@/api/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

interface LoginValues {
  email: string;
  password: string;
}

/** Only same-origin relative paths are honoured as a post-login destination. */
function redirectTarget(state: unknown): string {
  if (typeof state === 'object' && state !== null && 'from' in state) {
    const from = (state as { from?: unknown }).from;
    if (typeof from === 'string' && from.startsWith('/') && !from.startsWith('//')) return from;
  }
  return '/';
}

export function LoginPage() {
  const meta = usePlatformMeta();
  const limits: PlatformLimits = meta.data?.limits ?? DEFAULT_LIMITS;
  const schema = React.useMemo(() => createLoginSchema(limits), [limits]);
  const location = useLocation();
  const navigate = useNavigate();
  const login = useLogin();

  const form = useForm<LoginValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const rootError = form.formState.errors.root?.message;

  const onSubmit = form.handleSubmit((values) => {
    login.mutate(values, {
      onSuccess: () => {
        toast.success('Signed in');
        navigate(redirectTarget(location.state), { replace: true });
      },
      onError: (error) => {
        form.setError('root', {
          type: 'server',
          message: error instanceof Error ? error.message : 'Sign in failed. Please try again.',
        });
      },
    });
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1.5 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Sign in to PulseCheck</h1>
          <p className="text-sm text-muted-foreground">
            API monitoring, uptime analytics and incident history.
          </p>
        </div>

        <Card>
          <CardContent className="p-5 pt-5">
            <Form {...form}>
              <form onSubmit={onSubmit} className="space-y-4" noValidate>
                {rootError ? (
                  <p
                    role="alert"
                    aria-live="assertive"
                    className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                  >
                    {rootError}
                  </p>
                ) : null}

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          autoComplete="email"
                          placeholder="you@example.com"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input type="password" autoComplete="current-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button type="submit" className="w-full" loading={login.isPending}>
                  Sign in
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          No account?{' '}
          <Link
            to="/register"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
