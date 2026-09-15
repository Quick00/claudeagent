import { prisma } from '@/lib/prisma';
import * as mcpOauth from '@/lib/mcp-oauth';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    mcpServer: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}));
jest.mock('@/lib/mcp-oauth', () => ({
  discoverMcpServer: jest.fn(),
  registerMcpClient: jest.fn(),
}));
jest.mock('@/lib/crypto', () => ({ encrypt: (s: string) => `enc:${s}`, decrypt: (s: string) => s.replace(/^enc:/, '') }));
jest.mock('@/lib/mcp-url-safety', () => ({ assertSafeMcpUrl: jest.fn() }));

const mockDiscover = mcpOauth.discoverMcpServer as jest.Mock;
const mockRegister = mcpOauth.registerMcpClient as jest.Mock;

const DISCOVERED = {
  resource: 'https://mcp.example.com/mcp',
  authorizationServerUrl: 'https://auth.example.com',
  authorizeEndpoint: 'https://auth.example.com/authorize',
  tokenEndpoint: 'https://auth.example.com/token',
  registrationEndpoint: 'https://auth.example.com/register',
  revocationEndpoint: 'https://auth.example.com/revoke',
  scope: 'mcp:use',
  tokenEndpointAuthMethod: 'client_secret_post',
  metadata: {},
};

describe('mcp-servers-admin', () => {
  beforeEach(() => jest.clearAllMocks());

  it('registerMcpServer attempts DCR and stores DYNAMIC credentials on success', async () => {
    mockDiscover.mockResolvedValue(DISCOVERED);
    mockRegister.mockResolvedValue({ client_id: 'client-1', client_secret: 'secret-1' });
    (prisma.mcpServer.create as jest.Mock).mockImplementation(({ data }) => ({ id: 's1', ...data }));

    const { registerMcpServer } = await import('@/lib/mcp-servers-admin');
    const server = await registerMcpServer({ name: 'sentry', serverUrl: 'https://mcp.example.com/mcp', createdByUserId: 'admin-1' });

    expect(server.registrationMode).toBe('DYNAMIC');
    expect(prisma.mcpServer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'sentry',
          registrationMode: 'DYNAMIC',
          clientId: 'client-1',
          clientSecret: 'enc:secret-1',
          resource: DISCOVERED.resource,
        }),
      }),
    );
  });

  it('registerMcpServer rejects a name that is not slug-safe, or that collides with the built-in "knowledge" server', async () => {
    const { registerMcpServer } = await import('@/lib/mcp-servers-admin');
    await expect(
      registerMcpServer({ name: 'Sentry MCP!', serverUrl: 'https://mcp.example.com/mcp', createdByUserId: 'admin-1' }),
    ).rejects.toThrow('lowercase letters, numbers, and hyphens');
    await expect(
      registerMcpServer({ name: 'knowledge', serverUrl: 'https://mcp.example.com/mcp', createdByUserId: 'admin-1' }),
    ).rejects.toThrow('reserved');
    expect(mockDiscover).not.toHaveBeenCalled();
  });

  it('registerMcpServer falls back to MANUAL when the server has no registration_endpoint', async () => {
    mockDiscover.mockResolvedValue({ ...DISCOVERED, registrationEndpoint: undefined });
    (prisma.mcpServer.create as jest.Mock).mockImplementation(({ data }) => ({ id: 's2', ...data }));

    const { registerMcpServer } = await import('@/lib/mcp-servers-admin');
    const server = await registerMcpServer({ name: 'acme', serverUrl: 'https://mcp.acme.com/mcp', createdByUserId: 'admin-1' });

    expect(mockRegister).not.toHaveBeenCalled();
    expect(server.registrationMode).toBe('MANUAL');
    expect(server.clientId).toBeNull();
  });

  it('registerMcpServer falls back to MANUAL when DCR itself fails', async () => {
    mockDiscover.mockResolvedValue(DISCOVERED);
    mockRegister.mockRejectedValue(new Error('registration_endpoint returned 500'));
    (prisma.mcpServer.create as jest.Mock).mockImplementation(({ data }) => ({ id: 's3', ...data }));

    const { registerMcpServer } = await import('@/lib/mcp-servers-admin');
    const server = await registerMcpServer({ name: 'flaky', serverUrl: 'https://mcp.flaky.com/mcp', createdByUserId: 'admin-1' });

    expect(server.registrationMode).toBe('MANUAL');
  });

  it('saveManualMcpServerClient encrypts the client secret and stores it as MANUAL', async () => {
    (prisma.mcpServer.update as jest.Mock).mockImplementation(({ data }) => ({ id: 's2', ...data }));

    const { saveManualMcpServerClient } = await import('@/lib/mcp-servers-admin');
    const server = await saveManualMcpServerClient('s2', { clientId: 'manual-client', clientSecret: 'manual-secret' });

    expect(prisma.mcpServer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's2' },
        data: expect.objectContaining({ clientId: 'manual-client', clientSecret: 'enc:manual-secret', registrationMode: 'MANUAL' }),
      }),
    );
    expect(server.clientSecret).toBe('enc:manual-secret');
  });

  it('saveManualMcpServerClient runs every admin-entered endpoint URL through the same SSRF check as discovery', async () => {
    const { assertSafeMcpUrl } = await import('@/lib/mcp-url-safety');
    (prisma.mcpServer.update as jest.Mock).mockResolvedValue({ id: 's2' });

    const { saveManualMcpServerClient } = await import('@/lib/mcp-servers-admin');
    await saveManualMcpServerClient('s2', {
      clientId: 'manual-client',
      authorizeEndpoint: 'https://auth.acme.com/authorize',
      tokenEndpoint: 'https://auth.acme.com/token',
      revocationEndpoint: 'https://auth.acme.com/revoke',
    });

    expect(assertSafeMcpUrl).toHaveBeenCalledWith('https://auth.acme.com/authorize');
    expect(assertSafeMcpUrl).toHaveBeenCalledWith('https://auth.acme.com/token');
    expect(assertSafeMcpUrl).toHaveBeenCalledWith('https://auth.acme.com/revoke');
  });

  it('saveManualMcpServerClient rejects an unsafe endpoint URL instead of saving it', async () => {
    const { assertSafeMcpUrl } = await import('@/lib/mcp-url-safety');
    (assertSafeMcpUrl as jest.Mock).mockRejectedValueOnce(new Error('must use https'));

    const { saveManualMcpServerClient } = await import('@/lib/mcp-servers-admin');
    await expect(
      saveManualMcpServerClient('s2', { clientId: 'c1', tokenEndpoint: 'http://auth.acme.com/token' }),
    ).rejects.toThrow('must use https');
    expect(prisma.mcpServer.update).not.toHaveBeenCalled();
  });

  it('setMcpServerEnabled toggles enabled without touching connections', async () => {
    (prisma.mcpServer.update as jest.Mock).mockResolvedValue({ id: 's1', enabled: true });
    const { setMcpServerEnabled } = await import('@/lib/mcp-servers-admin');
    await setMcpServerEnabled('s1', true);
    expect(prisma.mcpServer.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { enabled: true } });
  });

  it('reRegisterMcpServerClient re-runs DCR for a DYNAMIC server', async () => {
    mockDiscover.mockResolvedValue(DISCOVERED);
    mockRegister.mockResolvedValue({ client_id: 'client-2', client_secret: 'secret-2' });
    (prisma.mcpServer.update as jest.Mock).mockImplementation(({ data }) => ({ id: 's1', registrationMode: 'DYNAMIC', ...data }));

    const { reRegisterMcpServerClient } = await import('@/lib/mcp-servers-admin');
    const server = { id: 's1', serverUrl: 'https://mcp.example.com/mcp', registrationMode: 'DYNAMIC' } as never;
    const updated = await reRegisterMcpServerClient(server);

    expect(updated.clientId).toBe('client-2');
  });

  it('reRegisterMcpServerClient refuses a MANUAL server', async () => {
    const { reRegisterMcpServerClient } = await import('@/lib/mcp-servers-admin');
    const server = { id: 's2', serverUrl: 'https://mcp.acme.com/mcp', registrationMode: 'MANUAL' } as never;
    await expect(reRegisterMcpServerClient(server)).rejects.toThrow('MANUAL');
  });
});
