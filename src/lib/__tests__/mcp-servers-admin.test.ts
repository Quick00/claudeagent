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

  it('mcpCallbackUrl refuses a plain-http base in production, since an authorization code arrives on it', async () => {
    const { mcpCallbackUrl } = await import('@/lib/mcp-servers-admin');
    const url = process.env.NEXTAUTH_URL;
    const env = process.env.NODE_ENV;

    process.env.NEXTAUTH_URL = 'http://app.example.com';
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', configurable: true });
    expect(() => mcpCallbackUrl('s1')).toThrow(/https/);

    process.env.NEXTAUTH_URL = 'https://app.example.com';
    expect(mcpCallbackUrl('s1')).toBe('https://app.example.com/api/mcp-servers/s1/callback');

    Object.defineProperty(process.env, 'NODE_ENV', { value: env, configurable: true });
    process.env.NEXTAUTH_URL = url;
  });

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

  it('registerMcpServer stores the token endpoint auth method the registration response assigned, not the discovery guess', async () => {
    // Discovery's `[0]` of token_endpoint_auth_methods_supported said Basic;
    // the server assigned client_secret_post (RFC 7591 §3.2.1 lets it). The
    // stored value later becomes the *only* method the SDK is told the
    // server supports, so persisting the guess meant every token request
    // came back invalid_client.
    mockDiscover.mockResolvedValue({ ...DISCOVERED, tokenEndpointAuthMethod: 'client_secret_basic' });
    mockRegister.mockResolvedValue({ client_id: 'client-1', client_secret: 'secret-1', token_endpoint_auth_method: 'client_secret_post' });
    (prisma.mcpServer.create as jest.Mock).mockImplementation(({ data }) => ({ id: 's1', ...data }));

    const { registerMcpServer } = await import('@/lib/mcp-servers-admin');
    const server = await registerMcpServer({ name: 'sentry', serverUrl: 'https://mcp.example.com/mcp', createdByUserId: 'admin-1' });

    expect(server.tokenEndpointAuthMethod).toBe('client_secret_post');
  });

  it('registerMcpServer keeps the discovered auth method when the registration response does not name one', async () => {
    mockDiscover.mockResolvedValue(DISCOVERED);
    mockRegister.mockResolvedValue({ client_id: 'client-1', client_secret: 'secret-1' });
    (prisma.mcpServer.create as jest.Mock).mockImplementation(({ data }) => ({ id: 's1', ...data }));

    const { registerMcpServer } = await import('@/lib/mcp-servers-admin');
    const server = await registerMcpServer({ name: 'sentry', serverUrl: 'https://mcp.example.com/mcp', createdByUserId: 'admin-1' });

    expect(server.tokenEndpointAuthMethod).toBe(DISCOVERED.tokenEndpointAuthMethod);
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

  it('saveManualMcpServerClient leaves a stored client secret alone when the PATCH omits one', async () => {
    // An endpoint-only edit must not quietly turn a confidential client
    // into a public one — there is no form to put the secret back once the
    // server has a client id.
    (prisma.mcpServer.update as jest.Mock).mockImplementation(({ data }) => ({ id: 's2', ...data }));

    const { saveManualMcpServerClient } = await import('@/lib/mcp-servers-admin');
    await saveManualMcpServerClient('s2', { clientId: 'manual-client', tokenEndpoint: 'https://auth.acme.com/token' });

    const { data } = (prisma.mcpServer.update as jest.Mock).mock.calls[0][0];
    expect(data).not.toHaveProperty('clientSecret');
    expect(data).toEqual(expect.objectContaining({ clientId: 'manual-client', tokenEndpoint: 'https://auth.acme.com/token' }));
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

  it('reRegisterMcpServerClient re-runs DCR for a DYNAMIC server and persists what re-discovery found alongside the new client', async () => {
    // The endpoints and auth method were re-discovered to register against;
    // leaving the old ones on the row would authenticate the new client the
    // old client's way on the very next refresh.
    const rediscovered = {
      ...DISCOVERED,
      tokenEndpoint: 'https://auth.example.com/v2/token',
      revocationEndpoint: 'https://auth.example.com/v2/revoke',
      scope: 'mcp:use mcp:admin',
      tokenEndpointAuthMethod: 'client_secret_basic',
    };
    mockDiscover.mockResolvedValue(rediscovered);
    mockRegister.mockResolvedValue({ client_id: 'client-2', client_secret: 'secret-2', token_endpoint_auth_method: 'client_secret_post' });
    (prisma.mcpServer.update as jest.Mock).mockImplementation(({ data }) => ({ id: 's1', registrationMode: 'DYNAMIC', ...data }));

    const { reRegisterMcpServerClient } = await import('@/lib/mcp-servers-admin');
    const server = { id: 's1', serverUrl: 'https://mcp.example.com/mcp', registrationMode: 'DYNAMIC' } as never;
    const updated = await reRegisterMcpServerClient(server);

    expect(updated.clientId).toBe('client-2');
    expect(updated.clientSecret).toBe('enc:secret-2');
    expect(updated.tokenEndpoint).toBe('https://auth.example.com/v2/token');
    expect(updated.revocationEndpoint).toBe('https://auth.example.com/v2/revoke');
    expect(updated.scope).toBe('mcp:use mcp:admin');
    expect(updated.tokenEndpointAuthMethod).toBe('client_secret_post');
  });

  it('toAdminMcpServerView never carries the encrypted client secret or registration access token to the browser', async () => {
    const { toAdminMcpServerView } = await import('@/lib/mcp-servers-admin');
    const row = {
      id: 's1',
      name: 'sentry',
      serverUrl: 'https://mcp.example.com/mcp',
      transport: 'HTTP',
      resource: 'https://mcp.example.com/mcp',
      authorizationServerUrl: 'https://auth.example.com',
      authorizeEndpoint: 'https://auth.example.com/authorize',
      tokenEndpoint: 'https://auth.example.com/token',
      registrationEndpoint: 'https://auth.example.com/register',
      revocationEndpoint: null,
      scope: 'mcp:use',
      tokenEndpointAuthMethod: 'client_secret_post',
      clientId: 'client-1',
      clientSecret: 'enc:secret-1',
      clientSecretExpiresAt: null,
      registrationAccessToken: 'enc:rat-1',
      registrationMode: 'DYNAMIC',
      enabled: true,
      createdByUserId: 'admin-1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    };

    const view = toAdminMcpServerView(row);

    expect(view).not.toHaveProperty('clientSecret');
    expect(view).not.toHaveProperty('registrationAccessToken');
    expect(view).toEqual(
      expect.objectContaining({
        id: 's1',
        name: 'sentry',
        clientId: 'client-1',
        hasClientSecret: true,
        registrationMode: 'DYNAMIC',
        enabled: true,
        callbackUrl: expect.stringMatching(/\/api\/mcp-servers\/s1\/callback$/),
      }),
    );
    expect(toAdminMcpServerView({ ...row, clientSecret: null }).hasClientSecret).toBe(false);
  });

  it('reRegisterMcpServerClient refuses a MANUAL server', async () => {
    const { reRegisterMcpServerClient } = await import('@/lib/mcp-servers-admin');
    const server = { id: 's2', serverUrl: 'https://mcp.acme.com/mcp', registrationMode: 'MANUAL' } as never;
    await expect(reRegisterMcpServerClient(server)).rejects.toThrow('MANUAL');
  });
});
