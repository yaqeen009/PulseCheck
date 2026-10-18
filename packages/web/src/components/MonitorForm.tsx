import { zodResolver } from '@hookform/resolvers/zod';
import {
  HTTP_METHODS,
  METHODS_WITH_BODY,
  createMonitorCreateSchema,
  type HttpMethod,
  type MonitorDto,
  type PlatformLimits,
  type ValidationIssue,
} from '@pulsecheck/shared';
import { Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { formatInterval } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Payload produced by the shared create schema: the shape both endpoints accept. */
export type MonitorPayload = z.output<ReturnType<typeof createMonitorCreateSchema>>;

/**
 * Raw form values.
 *
 * Deliberately a local view type: number inputs hand back strings, an optional
 * degraded threshold has no value instead of `null`, and headers are edited as
 * ordered rows. The shared schema is the validator for all of them.
 */
/** Number inputs hand back strings; the shared schema coerces them. */
type NumericInput = number | string;

interface MonitorFormValues {
  name: string;
  url: string;
  method: HttpMethod;
  intervalSeconds: number;
  timeoutMs: NumericInput;
  expectedStatusMin: NumericInput;
  expectedStatusMax: NumericInput;
  headers: Record<string, string>;
  body: string;
  degradedResponseTimeMs: NumericInput | null;
  enabled: boolean;
}

interface HeaderRow {
  id: string;
  name: string;
  value: string;
}

const KNOWN_FIELDS: ReadonlyArray<keyof MonitorFormValues> = [
  'name',
  'url',
  'method',
  'intervalSeconds',
  'timeoutMs',
  'expectedStatusMin',
  'expectedStatusMax',
  'headers',
  'body',
  'degradedResponseTimeMs',
  'enabled',
];

/** Candidate intervals, filtered against the server's limits at render time. */
const INTERVAL_CANDIDATES = [30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600, 43200, 86400];

let headerRowSeed = 0;
function createHeaderRow(name = '', value = ''): HeaderRow {
  headerRowSeed += 1;
  return { id: `header-${headerRowSeed}`, name, value };
}

function rowsFromRecord(headers: Record<string, string>): HeaderRow[] {
  return Object.entries(headers).map(([name, value]) => createHeaderRow(name, value));
}

function recordFromRows(rows: HeaderRow[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) continue;
    record[name] = row.value.trim();
  }
  return record;
}

/** Read a possibly nested error message without relying on RHF's error generics. */
function readErrorMessage(errors: unknown, path: string): string | undefined {
  let node: unknown = errors;
  for (const key of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  if (typeof node === 'object' && node !== null && 'message' in node) {
    const message = (node as { message?: unknown }).message;
    return typeof message === 'string' && message.length > 0 ? message : undefined;
  }
  return undefined;
}

export interface MonitorFormProps {
  mode: 'create' | 'edit';
  limits: PlatformLimits;
  monitor?: MonitorDto | null;
  submitting?: boolean;
  /** Field-level issues from the server's VALIDATION_ERROR response. */
  serverIssues?: ValidationIssue[];
  onSubmit: (payload: MonitorPayload) => void;
  onCancel?: () => void;
}

export function MonitorForm({
  mode,
  limits,
  monitor,
  submitting = false,
  serverIssues,
  onSubmit,
  onCancel,
}: MonitorFormProps) {
  const schema = React.useMemo(() => createMonitorCreateSchema(limits), [limits]);

  const defaultValues = React.useMemo<MonitorFormValues>(
    () => ({
      name: monitor?.name ?? '',
      url: monitor?.url ?? '',
      method: monitor?.method ?? 'GET',
      intervalSeconds: monitor?.intervalSeconds ?? limits.defaultIntervalSeconds,
      timeoutMs: monitor?.timeoutMs ?? limits.defaultTimeoutMs,
      expectedStatusMin: monitor?.expectedStatusMin ?? 200,
      expectedStatusMax: monitor?.expectedStatusMax ?? 299,
      headers: monitor?.headers ?? {},
      body: monitor?.body ?? '',
      degradedResponseTimeMs: monitor?.degradedResponseTimeMs ?? null,
      enabled: monitor?.enabled ?? true,
    }),
    [limits, monitor],
  );

  const form = useForm<MonitorFormValues>({
    resolver: zodResolver(schema),
    defaultValues,
    mode: 'onSubmit',
  });

  const [headerRows, setHeaderRows] = React.useState<HeaderRow[]>(() =>
    monitor && Object.keys(monitor.headers).length > 0 ? rowsFromRecord(monitor.headers) : [],
  );

  // Keep the validated `headers` record in sync with the row editor. Validation is
  // left to submit time so a half-typed header name is not flagged mid-keystroke.
  React.useEffect(() => {
    form.setValue('headers', recordFromRows(headerRows), { shouldDirty: true });
  }, [form, headerRows]);

  // Surface server-side field errors on the matching input.
  React.useEffect(() => {
    if (!serverIssues || serverIssues.length === 0) return;
    const unhandled: string[] = [];
    for (const issue of serverIssues) {
      const [head] = issue.path.split('.');
      const field = head as keyof MonitorFormValues | undefined;
      if (field && KNOWN_FIELDS.includes(field)) {
        form.setError(field, { type: 'server', message: issue.message });
      } else {
        unhandled.push(issue.message);
      }
    }
    if (unhandled.length > 0) {
      form.setError('root', { type: 'server', message: unhandled.join(' ') });
    }
  }, [form, serverIssues]);

  const method = form.watch('method');
  const bodyAllowed = METHODS_WITH_BODY.includes(method);

  const intervalOptions = React.useMemo(() => {
    const options = INTERVAL_CANDIDATES.filter(
      (value) => value >= limits.minIntervalSeconds && value <= limits.maxIntervalSeconds,
    );
    const current = monitor?.intervalSeconds;
    if (current !== undefined && !options.includes(current)) {
      options.push(current);
    }
    return options.sort((left, right) => left - right);
  }, [limits.maxIntervalSeconds, limits.minIntervalSeconds, monitor?.intervalSeconds]);

  const handleSubmit = form.handleSubmit((values) => {
    // Re-parse so the payload is the schema's output type, not the raw form state.
    const parsed = schema.safeParse(values);
    if (!parsed.success) return;
    onSubmit(parsed.data);
  });

  const rootError = readErrorMessage(form.formState.errors, 'root');
  const headersError = readErrorMessage(form.formState.errors, 'headers');

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        {rootError ? (
          <div
            role="alert"
            aria-live="assertive"
            className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          >
            {rootError}
          </div>
        ) : null}

        <Card>
          <CardContent className="grid gap-5 p-5 pt-5 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Public API health" autoComplete="off" {...field} />
                  </FormControl>
                  <FormDescription>
                    A label for this monitor. Max {limits.maxNameLength} characters.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="url"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>URL</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="https://api.example.com/health"
                      inputMode="url"
                      autoComplete="off"
                      spellCheck={false}
                      className="font-mono text-xs"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Absolute http or https URL. Credentials in the URL are rejected.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="method"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Method</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a method" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {HTTP_METHODS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="intervalSeconds"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Check interval</FormLabel>
                  <Select
                    value={String(field.value)}
                    onValueChange={(value) => field.onChange(Number(value))}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select an interval" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {intervalOptions.map((option) => (
                        <SelectItem key={option} value={String(option)}>
                          {formatInterval(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Between {formatInterval(limits.minIntervalSeconds)} and{' '}
                    {formatInterval(limits.maxIntervalSeconds)}.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="timeoutMs"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Request timeout (ms)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={limits.minTimeoutMs}
                      max={limits.maxTimeoutMs}
                      step={100}
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormDescription>
                    {limits.minTimeoutMs}–{limits.maxTimeoutMs} ms.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="degradedResponseTimeMs"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Degraded threshold (ms)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={limits.maxTimeoutMs}
                      placeholder="Optional"
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      value={field.value ?? ''}
                      onChange={(event) => {
                        const raw = event.target.value;
                        field.onChange(raw === '' ? null : raw);
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    A response slower than this is marked degraded. Cannot exceed the timeout.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="expectedStatusMin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Expected status from</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={100}
                      max={599}
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="expectedStatusMax"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Expected status to</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={100}
                      max={599}
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <div className="flex items-center justify-between rounded-md border border-border px-4 py-3">
                    <div className="space-y-0.5">
                      <FormLabel>Monitoring enabled</FormLabel>
                      <FormDescription>
                        Disabled monitors keep their history and can be resumed later.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        aria-label="Monitoring enabled"
                      />
                    </FormControl>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-5 pt-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Request headers</p>
                <p className="text-xs text-muted-foreground">
                  Up to {limits.maxHeaders} headers. Hop-by-hop and managed headers are rejected by
                  the server.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setHeaderRows((rows) => [...rows, createHeaderRow()])}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add header
              </Button>
            </div>

            {headerRows.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                No custom headers. Add one if the endpoint needs an API key or a non-default accept
                header.
              </p>
            ) : (
              <div className="space-y-2">
                {headerRows.map((row, index) => (
                  <div key={row.id} className="flex items-center gap-2">
                    <Input
                      aria-label={`Header ${index + 1} name`}
                      placeholder="X-Api-Key"
                      className="font-mono text-xs"
                      value={row.name}
                      onChange={(event) =>
                        setHeaderRows((rows) =>
                          rows.map((candidate) =>
                            candidate.id === row.id
                              ? { ...candidate, name: event.target.value }
                              : candidate,
                          ),
                        )
                      }
                    />
                    <Input
                      aria-label={`Header ${index + 1} value`}
                      placeholder="value"
                      className="font-mono text-xs"
                      value={row.value}
                      onChange={(event) =>
                        setHeaderRows((rows) =>
                          rows.map((candidate) =>
                            candidate.id === row.id
                              ? { ...candidate, value: event.target.value }
                              : candidate,
                          ),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove header ${index + 1}`}
                      onClick={() => setHeaderRows((rows) => rows.filter((c) => c.id !== row.id))}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {headersError ? (
              <p aria-live="polite" className="text-xs font-medium text-destructive">
                {headersError}
              </p>
            ) : null}
          </CardContent>
        </Card>

        {bodyAllowed ? (
          <Card>
            <CardContent className="space-y-2 p-5 pt-5">
              <FormField
                control={form.control}
                name="body"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Request body</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={5}
                        placeholder={'{\n  "ping": true\n}'}
                        spellCheck={false}
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormDescription>
                      Sent as-is for {method} requests. Max {limits.maxRequestBodyBytes} bytes.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          {onCancel ? (
            <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
              Cancel
            </Button>
          ) : null}
          <Button type="submit" loading={submitting} className={cn('min-w-32')}>
            {mode === 'create' ? 'Create monitor' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
