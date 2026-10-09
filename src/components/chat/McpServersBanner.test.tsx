import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { skipToken, useQuery } from '@tanstack/react-query';
import { renderWithProviders } from '@/test/render';
import { qk } from '@/lib/query-keys';
import { McpServersBanner } from './McpServersBanner';

const mockFetch = jest.fn<(input: string, init?: RequestInit) => Promise<unknown>>();
global.fetch = mockFetch as unknown as typeof fetch;

const serversResponse = (servers: unknown[]) =>
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => servers });

/**
 * Shows once the banner's query has its data. Both observe the same cache
 * entry, so an absence check made after this appears runs after the banner
 * has rendered with that data too.
 */
function Settled() {
  const { isSuccess } = useQuery({ queryKey: qk.mcpServers.userList(), queryFn: skipToken });
  return isSuccess ? <span>settled</span> : null;
}

async function renderSettled() {
  const view = renderWithProviders(
    <>
      <McpServersBanner />
      <Settled />
    </>,
  );
  await screen.findByText('settled');
  return view;
}

describe('McpServersBanner', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    localStorage.clear();
  });

  test('renders nothing once every server is connected', async () => {
    serversResponse([
      { id: 'a', name: 'Jira', connectionStatus: 'CONNECTED' },
      { id: 'b', name: 'Sentry', connectionStatus: 'CONNECTED' },
    ]);
    await renderSettled();

    expect(screen.queryByRole('link', { name: 'Manage connections' })).not.toBeInTheDocument();
  });

  test('names only the servers that still need connecting', async () => {
    serversResponse([
      { id: 'a', name: 'Jira', connectionStatus: 'CONNECTED' },
      { id: 'b', name: 'Notion', connectionStatus: 'NOT_CONNECTED' },
    ]);
    renderWithProviders(<McpServersBanner />);

    expect(await screen.findByText('Notion')).toBeInTheDocument();
    expect(screen.getByText(/can be connected/)).toBeInTheDocument();
    expect(screen.queryByText(/Jira/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage connections' })).toHaveAttribute('href', '/settings');
  });

  test('says a broken connection needs reconnecting rather than connecting', async () => {
    serversResponse([
      { id: 'a', name: 'Jira', connectionStatus: 'ERROR' },
      { id: 'b', name: 'Notion', connectionStatus: 'NOT_CONNECTED' },
    ]);
    renderWithProviders(<McpServersBanner />);

    expect(await screen.findByText('Jira')).toBeInTheDocument();
    expect(screen.getByText(/needs reconnecting/)).toBeInTheDocument();
    expect(screen.getByText('Notion')).toBeInTheDocument();
  });

  test('renders nothing when no server is registered', async () => {
    serversResponse([]);
    await renderSettled();

    expect(screen.queryByRole('link', { name: 'Manage connections' })).not.toBeInTheDocument();
  });

  test('stays dismissed until a server is added', async () => {
    serversResponse([{ id: 'a', name: 'Jira', connectionStatus: 'NOT_CONNECTED' }]);
    const first = renderWithProviders(<McpServersBanner />);
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Jira')).not.toBeInTheDocument();
    first.unmount();

    const second = await renderSettled();
    expect(screen.queryByText('Jira')).not.toBeInTheDocument();
    second.unmount();

    serversResponse([
      { id: 'a', name: 'Jira', connectionStatus: 'NOT_CONNECTED' },
      { id: 'b', name: 'Sentry', connectionStatus: 'NOT_CONNECTED' },
    ]);
    renderWithProviders(<McpServersBanner />);
    expect(await screen.findByText('Jira and Sentry')).toBeInTheDocument();
  });

  test('comes back when a dismissed server is connected and then breaks', async () => {
    serversResponse([{ id: 'a', name: 'Jira', connectionStatus: 'NOT_CONNECTED' }]);
    const first = renderWithProviders(<McpServersBanner />);
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    first.unmount();

    serversResponse([{ id: 'a', name: 'Jira', connectionStatus: 'ERROR' }]);
    renderWithProviders(<McpServersBanner />);
    expect(await screen.findByText(/needs reconnecting/)).toBeInTheDocument();
  });

  test('stays hidden when one of the dismissed servers gets connected', async () => {
    serversResponse([
      { id: 'a', name: 'Jira', connectionStatus: 'NOT_CONNECTED' },
      { id: 'b', name: 'Sentry', connectionStatus: 'NOT_CONNECTED' },
    ]);
    const first = renderWithProviders(<McpServersBanner />);
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    first.unmount();

    serversResponse([
      { id: 'a', name: 'Jira', connectionStatus: 'CONNECTED' },
      { id: 'b', name: 'Sentry', connectionStatus: 'NOT_CONNECTED' },
    ]);
    await renderSettled();
    expect(screen.queryByText('Sentry')).not.toBeInTheDocument();
  });
});
