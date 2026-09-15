import { GET } from '@/app/api/mcp-servers/route';
import { POST as CONNECT } from '@/app/api/mcp-servers/[id]/connect/route';
import { GET as CALLBACK } from '@/app/api/mcp-servers/[id]/callback/route';
import { POST as DISCONNECT } from '@/app/api/mcp-servers/[id]/disconnect/route';
import { requireApprovedUser } from '@/lib/api-auth';
import { listMcpServersForUser, startMcpConnect, completeMcpConnect, disconnectMcpServer } from '@/lib/mcp-connections';

jest.mock('@/lib/api-auth', () => ({ requireApprovedUser: jest.fn() }));
jest.mock('@/lib/mcp-connections', () => ({
  listMcpServersForUser: jest.fn(),
  startMcpConnect: jest.fn(),
  completeMcpConnect: jest.fn(),
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

  it('POST disconnect removes the connection', async () => {
    const res = await DISCONNECT(new Request('http://localhost', { method: 'POST' }), params('s1'));
    expect(res.status).toBe(204);
    expect(disconnectMcpServer).toHaveBeenCalledWith('u1', 's1');
  });
});
