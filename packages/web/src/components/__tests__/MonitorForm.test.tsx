import { DEFAULT_LIMITS } from '@pulsecheck/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MonitorForm, type MonitorPayload } from '@/components/MonitorForm';

function renderForm(onSubmit: (payload: MonitorPayload) => void) {
  render(<MonitorForm mode="create" limits={DEFAULT_LIMITS} onSubmit={onSubmit} />);
}

describe('MonitorForm', () => {
  it('blocks submission and shows inline errors when required fields are empty', async () => {
    const onSubmit = vi.fn();
    renderForm(onSubmit);

    await userEvent.click(screen.getByRole('button', { name: 'Create monitor' }));

    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(await screen.findByText('URL is required')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects a URL that is not absolute', async () => {
    const onSubmit = vi.fn();
    renderForm(onSubmit);

    await userEvent.type(screen.getByLabelText('Name'), 'Public API');
    await userEvent.type(screen.getByLabelText('URL'), 'not-a-url');
    await userEvent.click(screen.getByRole('button', { name: 'Create monitor' }));

    expect(await screen.findByText('Enter a valid absolute URL')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits the shared schema output, including defaults and custom headers', async () => {
    const onSubmit = vi.fn<(payload: MonitorPayload) => void>();
    renderForm(onSubmit);

    await userEvent.type(screen.getByLabelText('Name'), 'Public API');
    await userEvent.type(screen.getByLabelText('URL'), 'https://api.example.com/health');

    await userEvent.click(screen.getByRole('button', { name: 'Add header' }));
    await userEvent.type(screen.getByLabelText('Header 1 name'), 'X-Api-Key');
    await userEvent.type(screen.getByLabelText('Header 1 value'), 'secret');

    await userEvent.click(screen.getByRole('button', { name: 'Create monitor' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const payload = onSubmit.mock.calls[0]?.[0];
    expect(payload).toBeDefined();
    expect(payload?.name).toBe('Public API');
    expect(payload?.url).toBe('https://api.example.com/health');
    expect(payload?.method).toBe('GET');
    expect(payload?.intervalSeconds).toBe(DEFAULT_LIMITS.defaultIntervalSeconds);
    expect(payload?.timeoutMs).toBe(DEFAULT_LIMITS.defaultTimeoutMs);
    expect(payload?.expectedStatusMin).toBe(200);
    expect(payload?.expectedStatusMax).toBe(299);
    expect(payload?.headers).toEqual({ 'X-Api-Key': 'secret' });
    expect(payload?.body).toBeNull();
    expect(payload?.enabled).toBe(true);
  });

  it('does not offer a request body for GET monitors', () => {
    renderForm(vi.fn());
    expect(screen.queryByLabelText('Request body')).not.toBeInTheDocument();
  });
});
