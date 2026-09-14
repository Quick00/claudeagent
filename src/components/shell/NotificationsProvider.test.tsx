import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { NotificationsProvider, useNotifications } from './NotificationsProvider';

function Probe() {
  const { notificationConvIds, pendingFlags, pendingFeedback } = useNotifications();
  return (
    <dl>
      <dd data-testid="ids">{notificationConvIds.join(',')}</dd>
      <dd data-testid="flags">{pendingFlags}</dd>
      <dd data-testid="feedback">{pendingFeedback}</dd>
    </dl>
  );
}

function jsonOk(body: unknown) {
  return { ok: true, json: async () => body } as Response;
}

const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.startsWith('/api/flags/notifications')) return jsonOk({ conversationIds: ['c1', 'c2'] });
  if (url.startsWith('/api/flags/admin-notifications')) return jsonOk({ count: 3 });
  if (url.startsWith('/api/admin/feedback')) return jsonOk([{ id: 'f1' }, { id: 'f2' }]);
  throw new Error(`unexpected fetch: ${url}`);
});

function calledUrls(): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input));
}

beforeEach(() => {
  fetchMock.mockClear();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('NotificationsProvider', () => {
  test('polls once on mount and exposes the counts', async () => {
    renderWithProviders(
      <NotificationsProvider isAdmin>
        <Probe />
      </NotificationsProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('flags')).toHaveTextContent('3'));
    expect(screen.getByTestId('ids')).toHaveTextContent('c1,c2');
    expect(screen.getByTestId('feedback')).toHaveTextContent('2');

    const urls = calledUrls();
    expect(urls.filter((u) => u.startsWith('/api/flags/notifications'))).toHaveLength(1);
    expect(urls.filter((u) => u.startsWith('/api/flags/admin-notifications'))).toHaveLength(1);
    expect(urls.filter((u) => u.startsWith('/api/admin/feedback'))).toHaveLength(1);
  });

  test('never calls the admin endpoints for a non-admin', async () => {
    renderWithProviders(
      <NotificationsProvider isAdmin={false}>
        <Probe />
      </NotificationsProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('ids')).toHaveTextContent('c1,c2'));
    expect(calledUrls()).toEqual(['/api/flags/notifications']);
    expect(screen.getByTestId('flags')).toHaveTextContent('0');
    expect(screen.getByTestId('feedback')).toHaveTextContent('0');
  });

  test('clears the polling interval on unmount', async () => {
    const clearSpy = jest.spyOn(global, 'clearInterval');
    const { unmount } = renderWithProviders(
      <NotificationsProvider isAdmin={false}>
        <Probe />
      </NotificationsProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('ids')).toHaveTextContent('c1,c2'));
    unmount();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  test('reads as all-quiet outside a provider', () => {
    renderWithProviders(<Probe />);
    expect(screen.getByTestId('ids')).toBeEmptyDOMElement();
    expect(screen.getByTestId('flags')).toHaveTextContent('0');
  });
});
