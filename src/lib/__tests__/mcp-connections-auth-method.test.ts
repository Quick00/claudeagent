import { prisma } from '@/lib/prisma';

/**
 * Deliberately does *not* mock `@/lib/mcp-oauth`, unlike the rest of
 * `mcp-connections.test.ts`: the thing under test is what the SDK's own
 * `selectClientAuthMethod` decides when handed the metadata that
 * `authContextFromServer` builds from a stored server row, which a mocked
 * `refreshTokens` would never exercise. `jest.mock` is per-file, hence a file
 * of its own rather than another case in the existing one.
 */
jest.mock('@/lib/prisma', () => ({
  prisma: {
    mcpServerConnection: { findMany: jest.fn(), update: jest.fn() },
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prismaMockTx)),
  },
}));
jest.mock('@/lib/mcp-servers-admin', () => ({
  mcpCallbackUrl: (id: string) => `https://app.example.com/api/mcp-servers/${id}/callback`,
  reRegisterMcpServerClient: jest.fn(),
}));
jest.mock('@/lib/crypto', () => ({ encrypt: (s: string) => `enc:${s}`, decrypt: (s: string) => s.replace(/^enc:/, '') }));
jest.mock('@/lib/config', () => ({ config: { mcpTokenRefreshMarginMs: 600000 } }));
jest.mock('@/lib/mcp-url-safety', () => ({
  createSafeFetch: () => (url: string | URL, init?: RequestInit) => (global.fetch as typeof fetch)(url, init),
}));

const prismaMockTx = {
  $queryRaw: jest.fn(),
  mcpServer: { findUniqueOrThrow: jest.fn() },
  mcpServerConnection: { update: jest.fn() },
};

const SERVER = {
  id: 'srv-1',
  name: 'sentry',
  serverUrl: 'https://mcp.sentry.dev/mcp',
  transport: 'HTTP',
  resource: 'https://mcp.sentry.dev/mcp',
  authorizationServerUrl: 'https://auth.sentry.dev',
  authorizeEndpoint: 'https://auth.sentry.dev/authorize',
  tokenEndpoint: 'https://auth.sentry.dev/token',
  revocationEndpoint: 'https://auth.sentry.dev/revoke',
  scope: 'mcp:use',
  clientId: 'client-1',
  clientSecret: 'enc:secret-1',
  tokenEndpointAuthMethod: 'client_secret_post',
  registrationMode: 'DYNAMIC',
  enabled: true,
};

const NEAR_EXPIRY = new Date(Date.now() + 60 * 1000);

function stageStaleConnection(server: typeof SERVER | (Omit<typeof SERVER, 'tokenEndpointAuthMethod'> & { tokenEndpointAuthMethod: null })) {
  (prisma.mcpServerConnection.findMany as jest.Mock).mockResolvedValue([
    { id: 'conn-1', accessToken: 'enc:at-old', refreshToken: 'enc:rt-1', expiresAt: NEAR_EXPIRY, mcpServer: server },
  ]);
  prismaMockTx.$queryRaw.mockResolvedValue([
    { id: 'conn-1', accessToken: 'enc:at-old', refreshToken: 'enc:rt-1', expiresAt: NEAR_EXPIRY, mcpServerId: 'srv-1' },
  ]);
  prismaMockTx.mcpServer.findUniqueOrThrow.mockResolvedValue(server);
}

/** The SDK reads `.ok`, then `OAuthTokensSchema.parse(await res.json())`, so this has to be a real `Response`. */
function tokenEndpointFetch() {
  return jest.fn(async () =>
    new Response(JSON.stringify({ access_token: 'at-new', token_type: 'Bearer', expires_in: 3600 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('token endpoint client authentication', () => {
  it("sends the client credentials in the POST body when the server's stored auth method is client_secret_post", async () => {
    stageStaleConnection(SERVER);
    const fetchMock = tokenEndpointFetch();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { getUsableConnectionsForSession } = await import('@/lib/mcp-connections');
    const { entries, dropped } = await getUsableConnectionsForSession('u1');

    expect(dropped).toEqual([]);
    expect(entries).toEqual([{ name: 'sentry', transport: 'HTTP', url: SERVER.serverUrl, accessToken: 'at-new' }]);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, { headers: Headers; body: URLSearchParams }];
    expect(url.toString()).toBe(SERVER.tokenEndpoint);
    expect(init.headers.get('Authorization')).toBeNull();
    expect(init.body.get('client_id')).toBe('client-1');
    expect(init.body.get('client_secret')).toBe('secret-1');
  });

  it('falls back to HTTP Basic when the server row records no auth method', async () => {
    stageStaleConnection({ ...SERVER, tokenEndpointAuthMethod: null });
    const fetchMock = tokenEndpointFetch();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { getUsableConnectionsForSession } = await import('@/lib/mcp-connections');
    await getUsableConnectionsForSession('u1');

    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, { headers: Headers; body: URLSearchParams }];
    expect(init.headers.get('Authorization')).toBe(`Basic ${Buffer.from('client-1:secret-1').toString('base64')}`);
    expect(init.body.get('client_secret')).toBeNull();
  });
});
