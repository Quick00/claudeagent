jest.mock('@/lib/mcp-url-safety', () => ({
  createSafeFetch: () => (url: string | URL, init?: RequestInit) => (global.fetch as typeof fetch)(url, init),
}));

const AUTH_SERVER = 'https://auth.example.com';
const SERVER_URL = 'https://mcp.example.com/mcp';

// The SDK does path-aware discovery first: for a server URL with a path
// (`/mcp`), it fetches `/.well-known/<type><path>` at the origin — NOT
// `<serverUrl>/.well-known/<type>` — falling back to the bare root
// `/.well-known/<type>` only on a 404. Route keys below match that exactly
// (verified against the installed `@modelcontextprotocol/sdk` source).
const PROTECTED_RESOURCE_URL = `https://mcp.example.com/.well-known/oauth-protected-resource/mcp`;
const AUTH_SERVER_METADATA_URL = `${AUTH_SERVER}/.well-known/oauth-authorization-server`;

function fakeFetch(routes: Record<string, unknown>) {
  return jest.fn(async (url: string | URL) => {
    const key = url.toString();
    if (key in routes) {
      return new Response(JSON.stringify(routes[key]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  });
}

const RESOURCE_METADATA = {
  resource: SERVER_URL,
  authorization_servers: [AUTH_SERVER],
};
const AUTH_SERVER_METADATA = {
  issuer: AUTH_SERVER,
  authorization_endpoint: `${AUTH_SERVER}/authorize`,
  token_endpoint: `${AUTH_SERVER}/token`,
  registration_endpoint: `${AUTH_SERVER}/register`,
  revocation_endpoint: `${AUTH_SERVER}/revoke`,
  response_types_supported: ['code'],
  scopes_supported: ['mcp:use'],
};

describe('mcp-oauth', () => {
  beforeEach(() => jest.clearAllMocks());

  it('discoverMcpServer combines protected-resource and authorization-server metadata', async () => {
    global.fetch = fakeFetch({
      [PROTECTED_RESOURCE_URL]: RESOURCE_METADATA,
      [AUTH_SERVER_METADATA_URL]: AUTH_SERVER_METADATA,
    });
    const { discoverMcpServer } = await import('@/lib/mcp-oauth');

    const discovered = await discoverMcpServer(SERVER_URL);

    expect(discovered.resource).toBe(SERVER_URL);
    expect(discovered.authorizationServerUrl).toBe(AUTH_SERVER);
    expect(discovered.authorizeEndpoint).toBe(`${AUTH_SERVER}/authorize`);
    expect(discovered.tokenEndpoint).toBe(`${AUTH_SERVER}/token`);
    expect(discovered.registrationEndpoint).toBe(`${AUTH_SERVER}/register`);
    expect(discovered.revocationEndpoint).toBe(`${AUTH_SERVER}/revoke`);
    expect(discovered.scope).toBe('mcp:use');
  });

  it("discoverMcpServer requests every scope the authorization server publishes, not just the first — the list is a set, not a ranking", async () => {
    global.fetch = fakeFetch({
      [PROTECTED_RESOURCE_URL]: RESOURCE_METADATA,
      [AUTH_SERVER_METADATA_URL]: { ...AUTH_SERVER_METADATA, scopes_supported: ['openid', 'mcp:tools'] },
    });
    const { discoverMcpServer } = await import('@/lib/mcp-oauth');

    const discovered = await discoverMcpServer(SERVER_URL);

    // `[0]` here had been `openid` alone: a token with no tool scope, every
    // tools/call rejected, Settings still saying CONNECTED.
    expect(discovered.scope).toBe('openid mcp:tools');
  });

  it("discoverMcpServer prefers the protected resource's own scopes_supported (RFC 9728) over the authorization server's", async () => {
    global.fetch = fakeFetch({
      [PROTECTED_RESOURCE_URL]: { ...RESOURCE_METADATA, scopes_supported: ['mcp:tools'] },
      [AUTH_SERVER_METADATA_URL]: { ...AUTH_SERVER_METADATA, scopes_supported: ['openid', 'profile', 'email', 'mcp:tools'] },
    });
    const { discoverMcpServer } = await import('@/lib/mcp-oauth');

    const discovered = await discoverMcpServer(SERVER_URL);

    expect(discovered.scope).toBe('mcp:tools');
  });

  it('discoverMcpServer leaves scope undefined when neither document publishes any, so the server applies its default', async () => {
    global.fetch = fakeFetch({
      [PROTECTED_RESOURCE_URL]: RESOURCE_METADATA,
      [AUTH_SERVER_METADATA_URL]: { ...AUTH_SERVER_METADATA, scopes_supported: undefined },
    });
    const { discoverMcpServer } = await import('@/lib/mcp-oauth');

    const discovered = await discoverMcpServer(SERVER_URL);

    expect(discovered.scope).toBeUndefined();
  });

  it('discoverMcpServer throws when the server has no authorization server metadata at all', async () => {
    global.fetch = fakeFetch({});
    const { discoverMcpServer } = await import('@/lib/mcp-oauth');
    await expect(discoverMcpServer(SERVER_URL)).rejects.toThrow('did not publish');
  });

  it('registerMcpClient performs dynamic client registration', async () => {
    const { discoverMcpServer, registerMcpClient } = await import('@/lib/mcp-oauth');
    global.fetch = fakeFetch({
      [PROTECTED_RESOURCE_URL]: RESOURCE_METADATA,
      [AUTH_SERVER_METADATA_URL]: AUTH_SERVER_METADATA,
    });
    const discovered = await discoverMcpServer(SERVER_URL);

    global.fetch = jest.fn(async (url: string | URL, init?: RequestInit) => {
      expect(url.toString()).toBe(`${AUTH_SERVER}/register`);
      const body = JSON.parse(init!.body as string);
      expect(body.redirect_uris).toEqual(['https://app.example.com/api/mcp-servers/s1/callback']);
      return new Response(JSON.stringify({ ...body, client_id: 'client-123', client_secret: 'secret-456' }), { status: 201 });
    });
    const clientInfo = await registerMcpClient(discovered, 'https://app.example.com/api/mcp-servers/s1/callback');

    expect(clientInfo.client_id).toBe('client-123');
    expect(clientInfo.client_secret).toBe('secret-456');
  });

  it('registerMcpClient asks for the full discovered scope, and passes through the auth method the server assigned', async () => {
    const { discoverMcpServer, registerMcpClient } = await import('@/lib/mcp-oauth');
    global.fetch = fakeFetch({
      [PROTECTED_RESOURCE_URL]: RESOURCE_METADATA,
      [AUTH_SERVER_METADATA_URL]: {
        ...AUTH_SERVER_METADATA,
        scopes_supported: ['openid', 'mcp:tools'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      },
    });
    const discovered = await discoverMcpServer(SERVER_URL);

    let requestedScope: string | undefined;
    global.fetch = jest.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string);
      requestedScope = body.scope;
      // RFC 7591 §3.2.1: the server may assign a different method than requested.
      return new Response(
        JSON.stringify({ ...body, client_id: 'client-123', client_secret: 'secret-456', token_endpoint_auth_method: 'client_secret_post' }),
        { status: 201 },
      );
    });
    const clientInfo = await registerMcpClient(discovered, 'https://app.example.com/api/mcp-servers/s1/callback');

    expect(requestedScope).toBe('openid mcp:tools');
    expect(clientInfo.token_endpoint_auth_method).toBe('client_secret_post');
  });

  it('buildAuthorizationRequest generates a PKCE code verifier and includes the resource parameter', async () => {
    global.fetch = fakeFetch({
      [PROTECTED_RESOURCE_URL]: RESOURCE_METADATA,
      [AUTH_SERVER_METADATA_URL]: AUTH_SERVER_METADATA,
    });
    const { discoverMcpServer, buildAuthorizationRequest } = await import('@/lib/mcp-oauth');
    const discovered = await discoverMcpServer(SERVER_URL);
    const clientInfo = { client_id: 'client-123', redirect_uris: ['https://app.example.com/cb'] };

    const { authorizationUrl, codeVerifier } = await buildAuthorizationRequest(
      discovered,
      clientInfo as never,
      'https://app.example.com/cb',
      'state-abc',
    );

    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(`${AUTH_SERVER}/authorize`);
    expect(authorizationUrl.searchParams.get('resource')).toBe(SERVER_URL);
    expect(authorizationUrl.searchParams.get('state')).toBe('state-abc');
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(codeVerifier.length).toBeGreaterThan(20);
  });

  it('exchangeCode posts the authorization_code grant and returns tokens', async () => {
    global.fetch = fakeFetch({
      [PROTECTED_RESOURCE_URL]: RESOURCE_METADATA,
      [AUTH_SERVER_METADATA_URL]: AUTH_SERVER_METADATA,
    });
    const { discoverMcpServer, exchangeCode } = await import('@/lib/mcp-oauth');
    const discovered = await discoverMcpServer(SERVER_URL);
    const clientInfo = { client_id: 'client-123', redirect_uris: ['https://app.example.com/cb'] };

    global.fetch = jest.fn(async () =>
      new Response(
        JSON.stringify({ access_token: 'at-1', token_type: 'Bearer', refresh_token: 'rt-1', expires_in: 3600 }),
        { status: 200 },
      ),
    );

    const tokens = await exchangeCode(discovered, clientInfo as never, 'code-1', 'verifier-1', 'https://app.example.com/cb');

    expect(tokens.access_token).toBe('at-1');
    expect(tokens.refresh_token).toBe('rt-1');
  });

  it('refreshTokens throws InvalidGrantError for a revoked refresh token', async () => {
    // parseErrorResponse (inside the SDK) only recognizes an actual `Response`
    // instance — it calls `.text()` on it — so the fake here must be a real
    // one, not a plain object with an `ok`/`status`/`json` shape.
    const { refreshTokens, InvalidGrantError } = await import('@/lib/mcp-oauth');
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'refresh token revoked' }), { status: 400 }),
    );

    const clientInfo = { client_id: 'client-123', redirect_uris: ['https://app.example.com/cb'] };
    await expect(
      refreshTokens(AUTH_SERVER, AUTH_SERVER_METADATA as never, clientInfo as never, 'rt-expired', SERVER_URL),
    ).rejects.toBeInstanceOf(InvalidGrantError);
  });
});
