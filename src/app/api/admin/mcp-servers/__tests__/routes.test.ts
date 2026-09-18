import { GET, POST } from '@/app/api/admin/mcp-servers/route';
import { PATCH, DELETE } from '@/app/api/admin/mcp-servers/[id]/route';
import { requireAdminUser } from '@/lib/api-auth';
import {
  listMcpServersAdmin,
  registerMcpServer,
  saveManualMcpServerClient,
  setMcpServerEnabled,
  deleteMcpServer,
  setMcpServerDescription,
} from '@/lib/mcp-servers-admin';
import { config } from '@/lib/config';

jest.mock('@/lib/api-auth', () => ({ requireAdminUser: jest.fn() }));
// The projection itself is covered in mcp-servers-admin.test.ts; here it is
// a marker, so each route can be shown to answer with the projected shape
// rather than the raw row (which carries the encrypted client secret).
jest.mock('@/lib/mcp-servers-admin', () => ({
  listMcpServersAdmin: jest.fn(),
  registerMcpServer: jest.fn(),
  saveManualMcpServerClient: jest.fn(),
  setMcpServerEnabled: jest.fn(),
  deleteMcpServer: jest.fn(),
  setMcpServerDescription: jest.fn(),
  toAdminMcpServerView: jest.fn((server: { id: string }) => ({
    id: server.id,
    projected: true,
    callbackUrl: `https://app.example.com/api/mcp-servers/${server.id}/callback`,
  })),
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
  it('GET returns each server projected through the admin view (with its callback URL), and refuses non-admins', async () => {
    (listMcpServersAdmin as jest.Mock).mockResolvedValue([{ id: 's1', clientSecret: 'enc:never-sent' }]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: 's1', projected: true, callbackUrl: 'https://app.example.com/api/mcp-servers/s1/callback' },
    ]);
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
    expect(await res.json()).toEqual({ id: 's1', projected: true, callbackUrl: 'https://app.example.com/api/mcp-servers/s1/callback' });
    expect((await POST(json({ name: 'sentry' }))).status).toBe(400);
  });

  it('POST rejects a transport outside the two the schema allows', async () => {
    const res = await POST(json({ name: 'sentry', serverUrl: 'https://mcp.example.com/mcp', transport: 'WEBSOCKET' }));
    expect(res.status).toBe(400);
    expect(registerMcpServer).not.toHaveBeenCalled();
  });

  it('POST maps a discovery failure to 422 rather than 500', async () => {
    (registerMcpServer as jest.Mock).mockRejectedValue(new Error('mcp.example.com must use https'));
    const res = await POST(json({ name: 'bad', serverUrl: 'http://mcp.example.com/mcp' }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'mcp.example.com must use https' });
  });

  it('PATCH toggles enabled and answers with the projected row', async () => {
    (setMcpServerEnabled as jest.Mock).mockResolvedValue({ id: 's1', enabled: true, clientSecret: 'enc:never-sent' });
    const res = await PATCH(json({ enabled: true }, 'PATCH'), params('s1'));
    expect(res.status).toBe(200);
    expect(setMcpServerEnabled).toHaveBeenCalledWith('s1', true);
    expect(await res.json()).toEqual(expect.objectContaining({ id: 's1', projected: true }));
  });

  it('PATCH rejects a non-boolean enabled instead of coercing it', async () => {
    const res = await PATCH(json({ enabled: 'false' }, 'PATCH'), params('s1'));
    expect(res.status).toBe(400);
    expect(setMcpServerEnabled).not.toHaveBeenCalled();
  });

  it('PATCH saves manual client credentials and answers with the projected row', async () => {
    (saveManualMcpServerClient as jest.Mock).mockResolvedValue({ id: 's1', clientId: 'c1', clientSecret: 'enc:never-sent' });
    const res = await PATCH(json({ clientId: 'c1', clientSecret: 's3cr3t' }, 'PATCH'), params('s1'));
    expect(res.status).toBe(200);
    expect(saveManualMcpServerClient).toHaveBeenCalledWith('s1', { clientId: 'c1', clientSecret: 's3cr3t' });
    expect(await res.json()).toEqual(expect.objectContaining({ id: 's1', projected: true }));
  });

  it('PATCH saves the description the chat prompt will read', async () => {
    (setMcpServerDescription as jest.Mock).mockResolvedValue({ id: 's1', description: 'Customer tickets.' });
    const res = await PATCH(json({ description: 'Customer tickets.' }, 'PATCH'), params('s1'));
    expect(res.status).toBe(200);
    expect(setMcpServerDescription).toHaveBeenCalledWith('s1', 'Customer tickets.');
    expect(await res.json()).toEqual(expect.objectContaining({ id: 's1', projected: true }));
  });

  it('PATCH stores a blank description as no description at all', async () => {
    (setMcpServerDescription as jest.Mock).mockResolvedValue({ id: 's1', description: null });
    const res = await PATCH(json({ description: '   ' }, 'PATCH'), params('s1'));
    expect(res.status).toBe(200);
    expect(setMcpServerDescription).toHaveBeenCalledWith('s1', null);
  });

  it('PATCH refuses a description longer than the cap', async () => {
    const res = await PATCH(json({ description: 'x'.repeat(config.mcpServerDescriptionMaxLength + 1) }, 'PATCH'), params('s1'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/description/i);
    expect(setMcpServerDescription).not.toHaveBeenCalled();
  });

  it('PATCH refuses a description that is not text', async () => {
    const res = await PATCH(json({ description: 42 }, 'PATCH'), params('s1'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/description/i);
    expect(setMcpServerDescription).not.toHaveBeenCalled();
  });

  it('DELETE removes the server', async () => {
    (deleteMcpServer as jest.Mock).mockResolvedValue(undefined);
    const res = await DELETE(json({}, 'DELETE'), params('s1'));
    expect(res.status).toBe(204);
    expect(deleteMcpServer).toHaveBeenCalledWith('s1');
  });
});
