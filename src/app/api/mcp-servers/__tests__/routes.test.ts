import { GET } from '@/app/api/mcp-servers/route';
import { POST as CONNECT } from '@/app/api/mcp-servers/[id]/connect/route';
import { GET as CALLBACK } from '@/app/api/mcp-servers/[id]/callback/route';
import { POST as DISCONNECT } from '@/app/api/mcp-servers/[id]/disconnect/route';
import { requireApprovedUser } from '@/lib/api-auth';
import {
  listMcpServersForUser,
  startMcpConnect,
  completeMcpConnect,
  abandonMcpConnect,
  disconnectMcpServer,
} from '@/lib/mcp-connections';

jest.mock('@/lib/api-auth', () => ({ requireApprovedUser: jest.fn() }));
jest.mock('@/lib/mcp-connections', () => ({
  listMcpServersForUser: jest.fn(),
  startMcpConnect: jest.fn(),
  completeMcpConnect: jest.fn(),
  abandonMcpConnect: jest.fn(),
  disconnectMcpServer: jest.fn(),
}));

const mockAuth = requireApprovedUser as jest.Mock;
const user = { id: 'u1' };
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ ok: true, user });
});

describe('user mcp-servers routes', () => {
  it('GET lists servers for the signed-in user', async () => {
    (listMcpServersForUser as jest.Mock).mockResolvedValue([{ id: 's1', connectionStatus: 'NOT_CONNECTED' }]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(listMcpServersForUser).toHaveBeenCalledWith('u1');
  });

  it('POST connect returns an authorization URL', async () => {
    (startMcpConnect as jest.Mock).mockResolvedValue({ authorizationUrl: 'https://auth.example.com/authorize?...' });
    const res = await CONNECT(new Request('http://localhost', { method: 'POST' }), params('s1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authorizationUrl: 'https://auth.example.com/authorize?...' });
    expect(startMcpConnect).toHaveBeenCalledWith('u1', 's1');
  });

  it('GET callback exchanges the code and redirects to settings', async () => {
    (completeMcpConnect as jest.Mock).mockResolvedValue({ serverId: 's1' });
    const req = new Request('http://localhost/api/mcp-servers/s1/callback?state=abc&code=xyz');
    const res = await CALLBACK(req, params('s1'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/settings');
    expect(completeMcpConnect).toHaveBeenCalledWith('u1', 'abc', 'xyz');
  });

  it('GET callback redirects to settings with an error flag when the exchange fails', async () => {
    (completeMcpConnect as jest.Mock).mockRejectedValue(new Error('state expired'));
    const req = new Request('http://localhost/api/mcp-servers/s1/callback?state=abc&code=xyz');
    const res = await CALLBACK(req, params('s1'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('mcp_error=');
  });

  it("GET callback relays the authorization server's error (RFC 6749 §4.1.2.1) and spends the pending state", async () => {
    // What a user clicking "Cancel" on the consent screen comes back with:
    // an `error` and no `code`. The state row would otherwise never be
    // deleted — completeMcpConnect is the only other thing that does.
    const req = new Request(
      'http://localhost/api/mcp-servers/s1/callback?error=access_denied&error_description=The+user+declined&state=abc',
    );
    const res = await CALLBACK(req, params('s1'));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/settings');
    expect(location.searchParams.get('mcp_error')).toBe('access_denied: The user declined');
    expect(abandonMcpConnect).toHaveBeenCalledWith('u1', 'abc');
    expect(completeMcpConnect).not.toHaveBeenCalled();
  });

  it('GET callback relays a bare error code when no description came with it, and has no state to spend', async () => {
    const req = new Request('http://localhost/api/mcp-servers/s1/callback?error=server_error');
    const res = await CALLBACK(req, params('s1'));

    expect(new URL(res.headers.get('location')!).searchParams.get('mcp_error')).toBe('server_error');
    expect(abandonMcpConnect).not.toHaveBeenCalled();
  });

  it('POST disconnect removes the connection', async () => {
    const res = await DISCONNECT(new Request('http://localhost', { method: 'POST' }), params('s1'));
    expect(res.status).toBe(204);
    expect(disconnectMcpServer).toHaveBeenCalledWith('u1', 's1');
  });
});
