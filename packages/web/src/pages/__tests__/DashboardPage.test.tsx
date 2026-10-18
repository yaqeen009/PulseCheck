import type { DashboardActivityDto, DashboardSummaryDto } from '@pulsecheck/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAuthTokenProvider } from '@/lib/api-client';
import { DashboardPage } from '@/pages/DashboardPage';

/**
 * A brand-new account: the API answers with zeroes and `null` percentages. The
 * dashboard must show an empty state and em dashes — never a fabricated 0%.
 */
const EMPTY_SUMMARY: DashboardSummaryDto = {
  monitors: { total: 0, healthy: 0, degraded: 0, down: 0, paused: 0, pending: 0 },
  uptime: {
    window: '24h',
    stats: {
      totalChecks: 0,
      successfulChecks: 0,
      failedChecks: 0,
      respondedChecks: 0,
      uptimePercent: null,
      availabilityPercent: null,
      avgResponseTimeMs: null,
      minResponseTimeMs: null,
      maxResponseTimeMs: null,
      p95ResponseTimeMs: null,
    },
  },
  openIncidents: 0,
  incidentsLast24h: 0,
  checksLast24h: { total: 0, failed: 0, successRatePercent: null },
  slowestMonitors: [],
};

const EMPTY_ACTIVITY: DashboardActivityDto = { recentChecks: [], recentIncidents: [] };

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'ok',
    headers: { get: () => 'application/json' },
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function stubApi() {
  const mock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/api/v1/dashboard/summary')) {
      return Promise.resolve(jsonResponse(200, EMPTY_SUMMARY));
    }
    if (url.startsWith('/api/v1/dashboard/recent-activity')) {
      return Promise.resolve(jsonResponse(200, EMPTY_ACTIVITY));
    }
    if (url.startsWith('/api/v1/monitors')) {
      return Promise.resolve(jsonResponse(200, { items: [] }));
    }
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope' } }));
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DashboardPage with an empty account', () => {
  beforeEach(() => {
    // The page talks to the API through the shared client; give it a bearer
    // token instead of reaching a live Neon Auth server.
    setAuthTokenProvider(async () => 'test-jwt');
    stubApi();
  });

  afterEach(() => {
    setAuthTokenProvider(null);
    vi.unstubAllGlobals();
  });

  it('shows the empty state with a call to action and no invented metrics', async () => {
    renderDashboard();

    expect(await screen.findByText('No monitors yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /create your first monitor/i })).toBeInTheDocument();

    // Zeros are real data; a missing percentage must not be rendered as 0%.
    await waitFor(() => {
      expect(screen.queryByText('0.00%')).not.toBeInTheDocument();
    });
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByText('No checks in the last 24 hours')).toBeInTheDocument();
    expect(screen.getByText('No response-time data yet')).toBeInTheDocument();
  });

  it('labels empty activity lists instead of showing blank tables', async () => {
    renderDashboard();

    expect(await screen.findByText('No checks yet')).toBeInTheDocument();
    expect(
      await screen.findByText('Create a monitor to start collecting check results.'),
    ).toBeInTheDocument();
  });
});
