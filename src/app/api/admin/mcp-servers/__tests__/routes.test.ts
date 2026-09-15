import { GET, POST } from '@/app/api/admin/mcp-servers/route';
import { PATCH, DELETE } from '@/app/api/admin/mcp-servers/[id]/route';
import { requireAdminUser } from '@/lib/api-auth';
import {
  listMcpServersAdmin,
  registerMcpServer,
  saveManualMcpServerClient,
  setMcpServerEnabled,
  deleteMcpServer,
} from '@/lib/mcp-servers-admin';

jest.mock('@/lib/api-auth', () => ({ requireAdminUser: jest.fn() }));
jest.mock('@/lib/mcp-servers-admin', () => ({
  listMcpServersAdmin: jest.fn(),
  registerMcpServer: jest.fn(),
  saveManualMcpServerClient: jest.fn(),
  setMcpServerEnabled: jest.fn(),
  deleteMcpServer: jest.fn(),
  mcpCallbackUrl: (id: string) => `https://app.example.com/api/mcp-servers/${id}/callback`,
}));

const mockAuth = requireAdminUser as jest.Mock;
const admin = { id: 'a1', role: 'admin' };
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (body: unknown, method = 'POST') =>
  new Request('http://localhost', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ ok: true, user: admin });
});

describe('admin mcp-servers routes', () => {
  it('GET returns the list with each server\'s callback URL, and refuses non-admins', async () => {
    (listMcpServersAdmin as jest.Mock).mockResolvedValue([{ id: 's1' }]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 's1', callbackUrl: 'https://app.example.com/api/mcp-servers/s1/callback' }]);
    mockAuth.mockResolvedValue({ ok: false, response: new Response('Forbidden', { status: 403 }) });
    expect((await GET()).status).toBe(403);
  });

  it('POST registers a server (passing transport through) and validates required fields', async () => {
    (registerMcpServer as jest.Mock).mockResolvedValue({ id: 's1', name: 'sentry' });
    const res = await POST(json({ name: 'sentry', serverUrl: 'https://mcp.example.com/mcp', transport: 'SSE' }));
    expect(res.status).toBe(201);
    expect(registerMcpServer).toHaveBeenCalledWith({
      name: 'sentry',
      serverUrl: 'https://mcp.example.com/mcp',
      transport: 'SSE',
      createdByUserId: 'a1',
    });
    expect(await res.json()).toEqual(expect.objectContaining({ callbackUrl: 'https://app.example.com/api/mcp-servers/s1/callback' }));
    expect((await POST(json({ name: 'sentry' }))).status).toBe(400);
  });

  it('POST maps a discovery failure to 422 rather than 500', async () => {
    (registerMcpServer as jest.Mock).mockRejectedValue(new Error('mcp.example.com must use https'));
    const res = await POST(json({ name: 'bad', serverUrl: 'http://mcp.example.com/mcp' }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'mcp.example.com must use https' });
  });

  it('PATCH toggles enabled', async () => {
    (setMcpServerEnabled as jest.Mock).mockResolvedValue({ id: 's1', enabled: true });
    const res = await PATCH(json({ enabled: true }, 'PATCH'), params('s1'));
    expect(res.status).toBe(200);
    expect(setMcpServerEnabled).toHaveBeenCalledWith('s1', true);
  });

  it('PATCH saves manual client credentials', async () => {
    (saveManualMcpServerClient as jest.Mock).mockResolvedValue({ id: 's1', clientId: 'c1' });
    const res = await PATCH(json({ clientId: 'c1', clientSecret: 's3cr3t' }, 'PATCH'), params('s1'));
    expect(res.status).toBe(200);
    expect(saveManualMcpServerClient).toHaveBeenCalledWith('s1', { clientId: 'c1', clientSecret: 's3cr3t' });
  });

  it('DELETE removes the server', async () => {
    (deleteMcpServer as jest.Mock).mockResolvedValue(undefined);
    const res = await DELETE(json({}, 'DELETE'), params('s1'));
    expect(res.status).toBe(204);
    expect(deleteMcpServer).toHaveBeenCalledWith('s1');
  });
});
