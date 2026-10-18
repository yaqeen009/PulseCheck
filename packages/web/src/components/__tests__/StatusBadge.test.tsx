import { MONITOR_STATUSES, STATUS_LABELS } from '@pulsecheck/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from '@/components/StatusBadge';
import { StatusDot } from '@/components/StatusDot';

describe('StatusBadge', () => {
  it('renders the shared label for every status', () => {
    for (const status of MONITOR_STATUSES) {
      const { unmount } = render(<StatusBadge status={status} />);
      expect(screen.getByText(STATUS_LABELS[status])).toBeInTheDocument();
      unmount();
    }
  });

  it('exposes the status in the DOM so tests and styling can target it', () => {
    render(<StatusBadge status="DOWN" />);
    expect(screen.getByText('Down').closest('[data-status]')).toHaveAttribute(
      'data-status',
      'DOWN',
    );
  });
});

describe('StatusDot', () => {
  it('is announced with its status label instead of relying on colour', () => {
    render(<StatusDot status="DEGRADED" />);
    expect(screen.getByRole('img', { name: 'Degraded' })).toBeInTheDocument();
  });
});
