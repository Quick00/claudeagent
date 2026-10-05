import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { McpServersBanner } from './McpServersBanner';

const mockFetch = jest.fn<(input: string, init?: RequestInit) => Promise<unknown>>();
global.fetch = mockFetch as unknown as typeof fetch;

const serversResponse = (servers: unknown[]) =>
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => servers });

describe('McpServersBanner', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    localStorage.clear();
  });

  test('names the connected servers and links to settings', async () => {
    serversResponse([
      { id: 'a', name: 'Jira', connectionStatus: 'CONNECTED' },
      { id: 'b', name: 'Sentry', connectionStatus: 'CONNECTED' },
    ]);
    renderWithProviders(<McpServersBanner />);

    expect(await screen.findByText('Jira and Sentry')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage connections' })).toHaveAttribute('href', '/settings');
  });

  test('says which servers still need connecting', async () => {
    serversResponse([
      { id: 'a', name: 'Jira', connectionStatus: 'CONNECTED' },
      { id: 'b', name: 'Notion', connectionStatus: 'NOT_CONNECTED' },
    ]);
    renderWithProviders(<McpServersBanner />);

    expect(await screen.findByText('Notion')).toBeInTheDocument();
    expect(screen.getByText(/can be connected/)).toBeInTheDocument();
  });

  test('renders nothing when no server is registered', async () => {
    serversResponse([]);
    renderWithProviders(<McpServersBanner />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('link', { name: 'Manage connections' })).not.toBeInTheDocument();
  });

  test('stays dismissed until the set of servers changes', async () => {
    serversResponse([{ id: 'a', name: 'Jira', connectionStatus: 'CONNECTED' }]);
    const first = renderWithProviders(<McpServersBanner />);
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Jira')).not.toBeInTheDocument();
    first.unmount();

    renderWithProviders(<McpServersBanner />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText('Jira')).not.toBeInTheDocument();
    first.unmount();

    serversResponse([
      { id: 'a', name: 'Jira', connectionStatus: 'CONNECTED' },
      { id: 'b', name: 'Sentry', connectionStatus: 'CONNECTED' },
    ]);
    renderWithProviders(<McpServersBanner />);
    expect(await screen.findByText('Jira and Sentry')).toBeInTheDocument();
  });
});
