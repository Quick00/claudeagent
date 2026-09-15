import { describe, expect, jest, test } from '@jest/globals';
import { screen } from '@testing-library/react';
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
