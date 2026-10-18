import { zodResolver } from '@hookform/resolvers/zod';
import { createRegisterSchema } from '@pulsecheck/shared';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useRegister } from '@/api/auth';
import { usePlatformMeta } from '@/api/meta';
import { ErrorState } from '@/components/ErrorState';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

interface RegisterValues {
  email: string;
  password: string;
}

/**
 * Registration.
 *
 * Validation limits come from `GET /meta/limits` rather than being hardcoded, so
 * the inline messages match the policy of the deployment that is actually
 * running. The form waits for that response instead of guessing.
 */
export function RegisterPage() {
  const meta = usePlatformMeta();
  const register = useRegister();
  const navigate = useNavigate();

  const schema = React.useMemo(
    () => (meta.data ? createRegisterSchema(meta.data.limits) : null),
    [meta.data],
  );

  const form = useForm<RegisterValues>({
    resolver: schema ? zodResolver(schema) : undefined,
    defaultValues: { email: '', password: '' },
    mode: 'onChange',
  });

  const rootError = form.formState.errors.root?.message;
  const password = form.watch('password');

  if (meta.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm space-y-3" aria-busy="true" aria-live="polite">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      </div>
    );
  }

  if (meta.isError || !schema || !meta.data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <ErrorState
          error={meta.error}
          title="Could not load registration policy"
          onRetry={() => {
            void meta.refetch();
          }}
        />
      </div>
    );
  }

  const limits = meta.data.limits;

  const onSubmit = form.handleSubmit((values) => {
    register.mutate(values, {
      onSuccess: () => {
        toast.success('Account created');
        navigate('/', { replace: true });
      },
      onError: (error) => {
        form.setError('root', {
          type: 'server',
          message:
            error instanceof Error ? error.message : 'Registration failed. Please try again.',
        });
      },
    });
  });

  const passwordTooShort = password.length > 0 && password.length < limits.minPasswordLength;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1.5 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Create your PulseCheck account</h1>
          <p className="text-sm text-muted-foreground">
            Monitor your endpoints and see uptime derived from real checks.
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
                          maxLength={limits.maxEmailLength}
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
                        <Input
                          type="password"
                          autoComplete="new-password"
                          maxLength={limits.maxPasswordLength}
                          aria-describedby="password-policy"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription id="password-policy">
                        {password.length}/{limits.maxPasswordLength} characters · at least{' '}
                        {limits.minPasswordLength} required
                        {passwordTooShort ? ' · too short' : ''}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button type="submit" className="w-full" loading={register.isPending}>
                  Create account
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          Already registered?{' '}
          <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
