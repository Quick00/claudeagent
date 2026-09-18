import { describe, expect, jest, test } from '@jest/globals';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import AdminMcpServers from './AdminMcpServers';

type Server = {
  id: string;
  name: string;
  serverUrl: string;
  enabled: boolean;
  registrationMode: 'DYNAMIC' | 'MANUAL';
  clientId: string | null;
  callbackUrl: string;
  description?: string | null;
};

function fetchMock(servers: Server[]) {
  return jest.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/admin/mcp-servers' && (!init || init.method === undefined)) {
      return { ok: true, json: async () => servers };
    }
    if (url === '/api/admin/mcp-servers' && init?.method === 'POST') {
      const body = JSON.parse(init.body as string);
      return {
        ok: true,
        json: async () => ({ id: 's-new', enabled: false, registrationMode: 'MANUAL', clientId: null, callbackUrl: 'https://app.example.com/api/mcp-servers/s-new/callback', ...body }),
      };
    }
    return { ok: true, json: async () => ({}) };
  });
}

describe('AdminMcpServers', () => {
  test('a failed load says so instead of claiming no servers are registered', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ error: 'Internal Server Error' }),
    })) as unknown as typeof fetch;

    renderWithProviders(<AdminMcpServers />);

    expect(await screen.findByText(/Internal Server Error/)).toBeInTheDocument();
    expect(screen.queryByText('No MCP servers yet')).not.toBeInTheDocument();
  });

  test('lists registered servers with their registration mode', async () => {
    global.fetch = fetchMock([
      {
        id: 's1',
        name: 'sentry',
        serverUrl: 'https://mcp.sentry.dev/mcp',
        enabled: true,
        registrationMode: 'DYNAMIC',
        clientId: 'c1',
        callbackUrl: 'https://app.example.com/api/mcp-servers/s1/callback',
      },
    ]) as unknown as typeof fetch;

    renderWithProviders(<AdminMcpServers />);

    expect(await screen.findByText('sentry')).toBeInTheDocument();
    expect(screen.getByText('DYNAMIC')).toBeInTheDocument();
  });

  test('submitting the add-server form posts name, serverUrl, and the chosen transport', async () => {
    const mock = fetchMock([]);
    global.fetch = mock as unknown as typeof fetch;

    const { user } = renderWithProviders(<AdminMcpServers />);

    await user.type(await screen.findByLabelText('Name'), 'sentry');
    await user.type(screen.getByLabelText('Server URL'), 'https://mcp.sentry.dev/mcp');
    await user.click(screen.getByRole('button', { name: 'Add Server' }));

    expect(mock).toHaveBeenCalledWith(
      '/api/admin/mcp-servers',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'sentry', serverUrl: 'https://mcp.sentry.dev/mcp', transport: 'HTTP' }),
      }),
    );
  });

  const SENTRY: Server = {
    id: 's1',
    name: 'sentry',
    serverUrl: 'https://mcp.sentry.dev/mcp',
    enabled: true,
    registrationMode: 'DYNAMIC',
    clientId: 'c1',
    callbackUrl: 'https://app.example.com/api/mcp-servers/s1/callback',
  };

  test('Delete asks for confirmation first — it cascades to every user\'s tokens — and only then calls the API', async () => {
    const mock = fetchMock([SENTRY]);
    global.fetch = mock as unknown as typeof fetch;

    const { user } = renderWithProviders(<AdminMcpServers />);
    await user.click(await screen.findByRole('button', { name: 'Delete sentry' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Delete "sentry"?')).toBeInTheDocument();
    expect(mock).not.toHaveBeenCalledWith('/api/admin/mcp-servers/s1', expect.objectContaining({ method: 'DELETE' }));

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith('/api/admin/mcp-servers/s1', expect.objectContaining({ method: 'DELETE' })),
    );
  });

  test('cancelling the confirmation deletes nothing', async () => {
    const mock = fetchMock([SENTRY]);
    global.fetch = mock as unknown as typeof fetch;

    const { user } = renderWithProviders(<AdminMcpServers />);
    await user.click(await screen.findByRole('button', { name: 'Delete sentry' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(mock).not.toHaveBeenCalledWith('/api/admin/mcp-servers/s1', expect.objectContaining({ method: 'DELETE' }));
    expect(screen.getByText('sentry')).toBeInTheDocument();
  });

  test('an admin can say what a server is for, and it is saved for the chat prompt to read', async () => {
    const mock = fetchMock([{ ...SENTRY, description: null }]);
    global.fetch = mock as unknown as typeof fetch;

    const { user } = renderWithProviders(<AdminMcpServers />);

    await user.type(await screen.findByLabelText('When to use sentry'), 'Error reports from the live product.');
    await user.click(screen.getByRole('button', { name: 'Save description for sentry' }));

    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith(
        '/api/admin/mcp-servers/s1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ description: 'Error reports from the live product.' }),
        }),
      ),
    );
  });

  test('a description already saved is shown for editing rather than starting blank', async () => {
    global.fetch = fetchMock([{ ...SENTRY, description: 'Error reports from the live product.' }]) as unknown as typeof fetch;

    renderWithProviders(<AdminMcpServers />);

    expect(await screen.findByLabelText('When to use sentry')).toHaveValue('Error reports from the live product.');
  });

  test('shows the manual-entry form, with the callback URL to register on the server\'s side, when a server has no client id yet', async () => {
    global.fetch = fetchMock([
      {
        id: 's2',
        name: 'acme',
        serverUrl: 'https://mcp.acme.com/mcp',
        enabled: false,
        registrationMode: 'MANUAL',
        clientId: null,
        callbackUrl: 'https://app.example.com/api/mcp-servers/s2/callback',
      },
    ]) as unknown as typeof fetch;

    renderWithProviders(<AdminMcpServers />);

    expect(await screen.findByText('acme')).toBeInTheDocument();
    expect(screen.getByText(/needs a client id/i)).toBeInTheDocument();
    expect(screen.getByText('https://app.example.com/api/mcp-servers/s2/callback')).toBeInTheDocument();
  });
});
