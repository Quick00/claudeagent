import { jest } from '@jest/globals';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';

type Server = { id: string; name: string; connectionStatus: 'CONNECTED' | 'ERROR' | 'NOT_CONNECTED'; lastError: string | null };

function fetchMock(servers: Server[]) {
  return jest.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/mcp-servers') return { ok: true, json: async () => servers };
    if (url.endsWith('/connect') && init?.method === 'POST') {
      return { ok: true, json: async () => ({ authorizationUrl: 'https://auth.example.com/authorize' }) };
    }
    if (url.endsWith('/disconnect') && init?.method === 'POST') return { ok: true, json: async () => ({}) };
    return { ok: true, json: async () => ({}) };
  });
}

// jsdom's `Location.assign` is a non-writable, non-configurable own
// property (verified against this project's jsdom 26.1.0), so neither
// `jest.spyOn(window.location, 'assign')` nor deleting/reassigning
// `window.location` can intercept it. The component calls the app's
// `navigateTo` seam instead, which this mocks directly.
jest.mock('@/lib/navigate', () => ({ navigateTo: jest.fn() }));

// `jest.mock` is not hoisted in this project's SWC transform (see
// UserSettings.test.tsx), so both the mocked module and the component under
// test are pulled in via `require` after the mock is registered rather than
// a top-level `import`.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { navigateTo } = require('@/lib/navigate') as typeof import('@/lib/navigate');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const McpServerConnections = (require('./McpServerConnections') as typeof import('./McpServerConnections')).default;

describe('McpServerConnections', () => {
  test('shows each server with its connection status', async () => {
    global.fetch = fetchMock([
      { id: 's1', name: 'sentry', connectionStatus: 'CONNECTED', lastError: null },
      { id: 's2', name: 'acme', connectionStatus: 'NOT_CONNECTED', lastError: null },
    ]) as unknown as typeof fetch;

    renderWithProviders(<McpServerConnections />);

    expect(await screen.findByText('sentry')).toBeInTheDocument();
    expect(screen.getAllByText('Connected')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  test('an ERROR connection shows a reconnect prompt with the stored error', async () => {
    global.fetch = fetchMock([
      { id: 's1', name: 'sentry', connectionStatus: 'ERROR', lastError: 'refresh token revoked' },
    ]) as unknown as typeof fetch;

    renderWithProviders(<McpServerConnections />);

    expect(await screen.findByText('refresh token revoked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
  });

  test('clicking Connect navigates the browser to the authorization URL', async () => {
    global.fetch = fetchMock([{ id: 's1', name: 'sentry', connectionStatus: 'NOT_CONNECTED', lastError: null }]) as unknown as typeof fetch;

    const { user } = renderWithProviders(<McpServerConnections />);
    await user.click(await screen.findByRole('button', { name: 'Connect' }));

    expect(navigateTo).toHaveBeenCalledWith('https://auth.example.com/authorize');
  });
});
