import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  test.each([
    ['PENDING', 'Pending', 'warning'],
    ['APPROVED', 'Approved', 'success'],
    ['REJECTED', 'Rejected', 'destructive'],
  ])('renders user status %s as "%s" with the %s variant', (value, label, variant) => {
    render(<StatusBadge kind="userStatus" value={value} />);
    const badge = screen.getByText(label);
    expect(badge).toHaveAttribute('data-variant', variant);
  });

  test('renders an admin role distinctly from a plain user', () => {
    const { rerender } = render(<StatusBadge kind="role" value="admin" />);
    expect(screen.getByText('Admin')).toHaveAttribute('data-variant', 'default');

    rerender(<StatusBadge kind="role" value="user" />);
    expect(screen.getByText('User')).toHaveAttribute('data-variant', 'secondary');
  });

  test('renders feedback TODO as warning and DONE as success', () => {
    const { rerender } = render(<StatusBadge kind="feedback" value="TODO" />);
    expect(screen.getByText('To Do')).toHaveAttribute('data-variant', 'warning');

    rerender(<StatusBadge kind="feedback" value="DONE" />);
    expect(screen.getByText('Done')).toHaveAttribute('data-variant', 'success');
  });

  test('renders an open flag as destructive and a resolved one as success', () => {
    const { rerender } = render(<StatusBadge kind="flag" value="PENDING" />);
    expect(screen.getByText('Pending')).toHaveAttribute('data-variant', 'destructive');

    rerender(<StatusBadge kind="flag" value="RESOLVED" />);
    expect(screen.getByText('Resolved')).toHaveAttribute('data-variant', 'success');
  });

  test('marks a pinned knowledge entry as warning so an admin sees it is human-owned', () => {
    render(<StatusBadge kind="knowledgeKind" value="pinned" />);
    expect(screen.getByText('Pinned rule')).toHaveAttribute('data-variant', 'warning');
  });

  test('renders a review type as an outline badge', () => {
    render(<StatusBadge kind="reviewType" value="proposed_update" />);
    expect(screen.getByText('Proposed update')).toHaveAttribute('data-variant', 'outline');
  });

  test('falls back to the raw value for an unmapped status', () => {
    render(<StatusBadge kind="userStatus" value="SOMETHING_NEW" />);
    expect(screen.getByText('SOMETHING_NEW')).toHaveAttribute('data-variant', 'secondary');
  });
});
