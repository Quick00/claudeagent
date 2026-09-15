import { prisma } from '@/lib/prisma';
import * as mcpOauth from '@/lib/mcp-oauth';
import * as mcpServersAdmin from '@/lib/mcp-servers-admin';
import { createSafeFetch } from '@/lib/mcp-url-safety';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    mcpServer: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
    mcpServerConnection: { findMany: jest.fn(), findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn() },
    mcpOAuthState: { create: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prismaMockTx)),
  },
}));
jest.mock('@/lib/mcp-oauth', () => ({
  buildAuthorizationRequest: jest.fn(),
  exchangeCode: jest.fn(),
  refreshTokens: jest.fn(),
  InvalidGrantError: class InvalidGrantError extends Error {},
  InvalidClientError: class InvalidClientError extends Error {},
}));
jest.mock('@/lib/mcp-servers-admin', () => ({
  mcpCallbackUrl: (id: string) => `https://app.example.com/api/mcp-servers/${id}/callback`,
  reRegisterMcpServerClient: jest.fn(),
}));
jest.mock('@/lib/crypto', () => ({ encrypt: (s: string) => `enc:${s}`, decrypt: (s: string) => s.replace(/^enc:/, '') }));
jest.mock('@/lib/config', () => ({ config: { mcpTokenRefreshMarginMs: 600000 } }));
jest.mock('@/lib/mcp-url-safety', () => ({ createSafeFetch: jest.fn() }));

const prismaMockTx = {
  $queryRaw: jest.fn(),
  mcpServer: { findUniqueOrThrow: jest.fn() },
  mcpServerConnection: { update: jest.fn() },
};

const mockRefresh = mcpOauth.refreshTokens as jest.Mock;
const mockReRegister = mcpServersAdmin.reRegisterMcpServerClient as jest.Mock;
const mockCreateSafeFetch = createSafeFetch as jest.Mock;
const mockSafeFetch = jest.fn();

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
  registrationMode: 'DYNAMIC',
  enabled: true,
};

// Simulates a connection one minute from expiry — used wherever a test wants
// `getUsableConnectionsForSession` to decide a refresh is needed, both
// before and after the row lock is (simulated as) acquired.
const NEAR_EXPIRY = new Date(Date.now() + 60 * 1000);

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateSafeFetch.mockReturnValue(mockSafeFetch);
  mockSafeFetch.mockResolvedValue({ ok: true });
});

describe('getUsableConnectionsForSession', () => {
  it('uses a still-valid access token without refreshing', async () => {
    (prisma.mcpServerConnection.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'conn-1',
        accessToken: 'enc:at-valid',
        refreshToken: 'enc:rt-1',
        expiresAt: new Date(Date.now() + 20 * 60 * 1000),
        mcpServer: SERVER,
      },
    ]);

    const { getUsableConnectionsForSession } = await import('@/lib/mcp-connections');
    const { entries, dropped } = await getUsableConnectionsForSession('u1');

    expect(entries).toEqual([{ name: 'sentry', transport: 'HTTP', url: SERVER.serverUrl, accessToken: 'at-valid' }]);
    expect(dropped).toEqual([]);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('refreshes a token expiring within the margin, using the endpoints stored on the server row rather than re-discovering them', async () => {
    (prisma.mcpServerConnection.findMany as jest.Mock).mockResolvedValue([
      { id: 'conn-1', accessToken: 'enc:at-old', refreshToken: 'enc:rt-1', expiresAt: NEAR_EXPIRY, mcpServer: SERVER },
    ]);
    prismaMockTx.$queryRaw.mockResolvedValue([
      { id: 'conn-1', accessToken: 'enc:at-old', refreshToken: 'enc:rt-1', expiresAt: NEAR_EXPIRY, mcpServerId: 'srv-1' },
    ]);
    prismaMockTx.mcpServer.findUniqueOrThrow.mockResolvedValue(SERVER);
    mockRefresh.mockResolvedValue({ access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600, token_type: 'Bearer' });

    const { getUsableConnectionsForSession } = await import('@/lib/mcp-connections');
    const { entries, dropped } = await getUsableConnectionsForSession('u1');

    expect(entries).toEqual([{ name: 'sentry', transport: 'HTTP', url: SERVER.serverUrl, accessToken: 'at-new' }]);
    expect(dropped).toEqual([]);
    expect(mockRefresh).toHaveBeenCalledWith(
      SERVER.authorizationServerUrl,
      expect.objectContaining({ token_endpoint: SERVER.tokenEndpoint, authorization_endpoint: SERVER.authorizeEndpoint }),
      expect.objectContaining({ client_id: 'client-1' }),
      'rt-1',
      SERVER.resource,
    );
    expect(prismaMockTx.mcpServerConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ accessToken: 'enc:at-new', status: 'CONNECTED' }) }),
    );
  });

  it('locks the connection row before refreshing, so two concurrent refreshes for the same connection cannot race', async () => {
    (prisma.mcpServerConnection.findMany as jest.Mock).mockResolvedValue([
      { id: 'conn-1', accessToken: 'enc:at-old', refreshToken: 'enc:rt-1', expiresAt: NEAR_EXPIRY, mcpServer: SERVER },
    ]);
    prismaMockTx.$queryRaw.mockResolvedValue([
      { id: 'conn-1', accessToken: 'enc:at-old', refreshToken: 'enc:rt-1', expiresAt: NEAR_EXPIRY, mcpServerId: 'srv-1' },
    ]);
    prismaMockTx.mcpServer.findUniqueOrThrow.mockResolvedValue(SERVER);
    mockRefresh.mockResolvedValue({ access_token: 'at-new', expires_in: 3600, token_type: 'Bearer' });

    const { getUsableConnectionsForSession } = await import('@/lib/mcp-connections');
    await getUsableConnectionsForSession('u1');

    // A real concurrent-race test needs a real Postgres connection (two
    // actual transactions contending for the row) — out of reach for a
    // mocked prisma client. This proves the lock is actually issued as part
    // of the same query that reads the row, which is what makes two
    // concurrent transactions serialize instead of both reading the same
    // refresh token; true concurrent behavior is exercised only in Task 14's
    // manual/integration pass against a real database.
    const [strings] = prismaMockTx.$queryRaw.mock.calls[0];
    expect((strings as unknown as string[]).join('')).toContain('FOR UPDATE');
  });

  it('re-checks freshness under the lock, so a second waiter that lost the race to refresh does not refresh again', async () => {
    (prisma.mcpServerConnection.findMany as jest.Mock).mockResolvedValue([
      { id: 'conn-1', accessToken: 'enc:at-old', refreshToken: 'enc:rt-1', expiresAt: NEAR_EXPIRY, mcpServer: SERVER },
    ]);
    // A concurrent transaction already refreshed this row by the time this
    // one's SELECT ... FOR UPDATE returns: the locked row it reads is fresh.
    prismaMockTx.$queryRaw.mockResolvedValue([
      {
        id: 'conn-1',
        accessToken: 'enc:at-already-fresh',
        refreshToken: 'enc:rt-1',
        expiresAt: new Date(Date.now() + 20 * 60 * 1000),
        mcpServerId: 'srv-1',
      },
    ]);

    const { getUsableConnectionsForSession } = await import('@/lib/mcp-connections');
    const { entries, dropped } = await getUsableConnectionsForSession('u1');

    expect(entries).toEqual([{ name: 'sentry', transport: 'HTTP', url: SERVER.serverUrl, accessToken: 'at-already-fresh' }]);
    expect(dropped).toEqual([]);
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(prismaMockTx.mcpServerConnection.update).not.toHaveBeenCalled();
  });

  it('drops the server (keeping status CONNECTED) on a network error refreshing', async () => {
    (prisma.mcpServerConnection.findMany as jest.Mock).mockResolvedValue([
      { id: 'conn-1', accessToken: 'enc:at-old', refreshToken: 'enc:rt-1', expiresAt: NEAR_EXPIRY, mcpServer: SERVER },
    ]);
    prismaMockTx.$queryRaw.mockResolvedValue([
      { id: 'conn-1', accessToken: 'enc:at-old', refreshToken: 'enc:rt-1', expiresAt: NEAR_EXPIRY, mcpServerId: 'srv-1' },
    ]);
    prismaMockTx.mcpServer.findUniqueOrThrow.mockResolvedValue(SERVER);
    mockRefresh.mockRejectedValue(new TypeError('fetch failed'));

    const { getUsableConnectionsForSession } = await import('@/lib/mcp-connections');
    const { entries, dropped } = await getUsableConnectionsForSession('u1');

    expect(entries).toEqual([]);
    expect(dropped).toEqual([{ name: 'sentry', reason: 'fetch failed' }]);
    expect(prisma.mcpServerConnection.update).not.toHaveBeenCalled();
  });

  it('flips status to ERROR, via a write outside the failed transaction, when the server rejects the refresh token', async () => {
    const { InvalidGrantError } = mcpOauth;
    (prisma.mcpServerConnection.findMany as jest.Mock).mockResolvedValue([
      { id: 'conn-1', accessToken: 'enc:at-old', refreshToken: 'enc:rt-1', expiresAt: NEAR_EXPIRY, mcpServer: SERVER },
    ]);
    prismaMockTx.$queryRaw.mockResolvedValue([
      { id: 'conn-1', accessToken: 'enc:at-old', refreshToken: 'enc:rt-1', expiresAt: NEAR_EXPIRY, mcpServerId: 'srv-1' },
    ]);
    prismaMockTx.mcpServer.findUniqueOrThrow.mockResolvedValue(SERVER);
    mockRefresh.mockRejectedValue(new InvalidGrantError('refresh token revoked'));

    const { getUsableConnectionsForSession } = await import('@/lib/mcp-connections');
    const { entries, dropped } = await getUsableConnectionsForSession('u1');

    expect(entries).toEqual([]);
    expect(dropped).toEqual([{ name: 'sentry', reason: 'refresh token revoked' }]);
    // Written by the top-level `prisma`, not `prismaMockTx`: a write inside
    // the same transaction callback that then throws would be rolled back
    // along with everything else in it, so this has to happen after.
    expect(prismaMockTx.mcpServerConnection.update).not.toHaveBeenCalled();
    expect(prisma.mcpServerConnection.update).toHaveBeenCalledWith({
      where: { id: 'conn-1' },
      data: { status: 'ERROR', lastError: 'refresh token revoked' },
    });
  });

  it('re-registers a DYNAMIC server on InvalidClientError and retries the refresh once', async () => {
    const { InvalidClientError } = mcpOauth;
    (prisma.mcpServerConnection.findMany as jest.Mock).mockResolvedValue([
      { id: 'conn-1', accessToken: 'enc:at-old', refreshToken: 'enc:rt-1', expiresAt: NEAR_EXPIRY, mcpServer: SERVER },
    ]);
    // Both the failed first attempt and the retry after re-registration
    // read the row via a fresh `SELECT ... FOR UPDATE` (two transactions),
    // so the mock returns the same still-stale row both times.
    prismaMockTx.$queryRaw.mockResolvedValue([
      { id: 'conn-1', accessToken: 'enc:at-old', refreshToken: 'enc:rt-1', expiresAt: NEAR_EXPIRY, mcpServerId: 'srv-1' },
    ]);
    prismaMockTx.mcpServer.findUniqueOrThrow.mockResolvedValue(SERVER);
    mockRefresh
      .mockRejectedValueOnce(new InvalidClientError('client not found'))
      .mockResolvedValueOnce({ access_token: 'at-after-reregister', expires_in: 3600, token_type: 'Bearer' });
    mockReRegister.mockResolvedValue({ ...SERVER, clientId: 'client-2', clientSecret: 'enc:secret-2' });

    const { getUsableConnectionsForSession } = await import('@/lib/mcp-connections');
    const { entries, dropped } = await getUsableConnectionsForSession('u1');

    expect(mockReRegister).toHaveBeenCalledWith(SERVER);
    expect(entries).toEqual([{ name: 'sentry', transport: 'HTTP', url: SERVER.serverUrl, accessToken: 'at-after-reregister' }]);
    expect(dropped).toEqual([]);
    // The lock is released before re-registration and re-acquired for the
    // retry, so this scenario runs two separate transactions rather than
    // nesting the re-registration call inside the first one's lock.
    expect((prisma.$transaction as jest.Mock).mock.calls.length).toBe(2);
  });

  it('drops the server, without retrying, when re-registration itself fails', async () => {
    const { InvalidClientError } = mcpOauth;
    (prisma.mcpServerConnection.findMany as jest.Mock).mockResolvedValue([
      { id: 'conn-1', accessToken: 'enc:at-old', refreshToken: 'enc:rt-1', expiresAt: NEAR_EXPIRY, mcpServer: SERVER },
    ]);
    prismaMockTx.$queryRaw.mockResolvedValue([
      { id: 'conn-1', accessToken: 'enc:at-old', refreshToken: 'enc:rt-1', expiresAt: NEAR_EXPIRY, mcpServerId: 'srv-1' },
    ]);
    prismaMockTx.mcpServer.findUniqueOrThrow.mockResolvedValue(SERVER);
    mockRefresh.mockRejectedValue(new InvalidClientError('client not found'));
    mockReRegister.mockRejectedValue(new Error('discovery unreachable'));

    const { getUsableConnectionsForSession } = await import('@/lib/mcp-connections');
    const { entries, dropped } = await getUsableConnectionsForSession('u1');

    expect(entries).toEqual([]);
    expect(dropped).toEqual([{ name: 'sentry', reason: 'discovery unreachable' }]);
    // Re-registration itself threw, so there's no retried refresh and thus
    // only the first transaction ran.
    expect((prisma.$transaction as jest.Mock).mock.calls.length).toBe(1);
  });

  it('flips status to ERROR for an expired connection the server never gave a refresh token for', async () => {
    const EXPIRED = new Date(Date.now() - 60 * 1000);
    (prisma.mcpServerConnection.findMany as jest.Mock).mockResolvedValue([
      { id: 'conn-1', accessToken: 'enc:at-expired', refreshToken: null, expiresAt: EXPIRED, mcpServer: SERVER },
    ]);
    prismaMockTx.$queryRaw.mockResolvedValue([
      { id: 'conn-1', accessToken: 'enc:at-expired', refreshToken: null, expiresAt: EXPIRED, mcpServerId: 'srv-1' },
    ]);

    const { getUsableConnectionsForSession } = await import('@/lib/mcp-connections');
    const { entries, dropped } = await getUsableConnectionsForSession('u1');

    // Handing back the expired token instead would keep the connection
    // reading as "Connected" in Settings while failing every single turn,
    // with no way for the user to see why or to re-authorize.
    expect(entries).toEqual([]);
    expect(dropped).toEqual([
      { name: 'sentry', reason: 'access token expired and no refresh token is available to renew it' },
    ]);
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(prisma.mcpServerConnection.update).toHaveBeenCalledWith({
      where: { id: 'conn-1' },
      data: { status: 'ERROR', lastError: 'access token expired and no refresh token is available to renew it' },
    });
  });

  it('keeps using a never-expiring connection that has no refresh token', async () => {
    (prisma.mcpServerConnection.findMany as jest.Mock).mockResolvedValue([
      { id: 'conn-1', accessToken: 'enc:at-eternal', refreshToken: null, expiresAt: null, mcpServer: SERVER },
    ]);

    const { getUsableConnectionsForSession } = await import('@/lib/mcp-connections');
    const { entries, dropped } = await getUsableConnectionsForSession('u1');

    expect(entries).toEqual([{ name: 'sentry', transport: 'HTTP', url: SERVER.serverUrl, accessToken: 'at-eternal' }]);
    expect(dropped).toEqual([]);
    expect(prisma.mcpServerConnection.update).not.toHaveBeenCalled();
  });

  it('lands a decrypt failure on an already-fresh token in `dropped` instead of throwing', async () => {
    (prisma.mcpServerConnection.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'conn-1',
        accessToken: 'not-encrypted-garbage',
        refreshToken: 'enc:rt-1',
        expiresAt: new Date(Date.now() + 20 * 60 * 1000),
        mcpServer: SERVER,
      },
    ]);
    const cryptoMock = jest.requireMock('@/lib/crypto') as { decrypt: (s: string) => string };
    const realDecrypt = cryptoMock.decrypt;
    cryptoMock.decrypt = jest.fn((s: string) => {
      if (s === 'not-encrypted-garbage') throw new Error('unable to decrypt: bad tag');
      return realDecrypt(s);
    });

    try {
      const { getUsableConnectionsForSession } = await import('@/lib/mcp-connections');
      const { entries, dropped } = await getUsableConnectionsForSession('u1');

      expect(entries).toEqual([]);
      expect(dropped).toEqual([{ name: 'sentry', reason: 'unable to decrypt: bad tag' }]);
      expect(mockRefresh).not.toHaveBeenCalled();
    } finally {
      cryptoMock.decrypt = realDecrypt;
    }
  });

  it('lands a null access token on an already-fresh connection in `dropped` instead of throwing', async () => {
    (prisma.mcpServerConnection.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'conn-1',
        accessToken: null,
        refreshToken: 'enc:rt-1',
        expiresAt: new Date(Date.now() + 20 * 60 * 1000),
        mcpServer: SERVER,
      },
    ]);

    const { getUsableConnectionsForSession } = await import('@/lib/mcp-connections');
    const { entries, dropped } = await getUsableConnectionsForSession('u1');

    expect(entries).toEqual([]);
    expect(dropped).toEqual([{ name: 'sentry', reason: 'connection has no access token' }]);
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

describe('startMcpConnect', () => {
  it('builds the authorization URL from the stored server row and records pending PKCE state', async () => {
    (prisma.mcpServer.findUniqueOrThrow as jest.Mock).mockResolvedValue(SERVER);
    (mcpOauth.buildAuthorizationRequest as jest.Mock).mockResolvedValue({
      authorizationUrl: new URL('https://auth.sentry.dev/authorize?state=abc'),
      codeVerifier: 'verifier-xyz',
    });

    const { startMcpConnect } = await import('@/lib/mcp-connections');
    const result = await startMcpConnect('u1', 'srv-1');

    expect(result).toEqual({ authorizationUrl: 'https://auth.sentry.dev/authorize?state=abc' });
    expect(mcpOauth.buildAuthorizationRequest).toHaveBeenCalledWith(
      expect.objectContaining({ authorizationServerUrl: SERVER.authorizationServerUrl, resource: SERVER.resource }),
      expect.objectContaining({ client_id: 'client-1' }),
      'https://app.example.com/api/mcp-servers/srv-1/callback',
      expect.any(String),
    );
    expect(prisma.mcpOAuthState.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ codeVerifier: 'verifier-xyz', userId: 'u1', mcpServerId: 'srv-1' }) }),
    );
  });

  it('refuses to connect to a server with no client id yet', async () => {
    (prisma.mcpServer.findUniqueOrThrow as jest.Mock).mockResolvedValue({ ...SERVER, clientId: null });
    const { startMcpConnect } = await import('@/lib/mcp-connections');
    await expect(startMcpConnect('u1', 'srv-1')).rejects.toThrow('not ready to connect');
  });
});

describe('completeMcpConnect', () => {
  const PENDING = { state: 'state-abc', codeVerifier: 'verifier-xyz', userId: 'u1', mcpServerId: 'srv-1', expiresAt: new Date(Date.now() + 60000) };

  it("exchanges the code and writes an encrypted connection for the state's recorded user", async () => {
    (prisma.mcpOAuthState.findUnique as jest.Mock).mockResolvedValue(PENDING);
    (prisma.mcpServer.findUniqueOrThrow as jest.Mock).mockResolvedValue(SERVER);
    (mcpOauth.exchangeCode as jest.Mock).mockResolvedValue({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, token_type: 'Bearer' });

    const { completeMcpConnect } = await import('@/lib/mcp-connections');
    const result = await completeMcpConnect('u1', 'state-abc', 'code-1');

    expect(result).toEqual({ serverId: 'srv-1' });
    expect(prisma.mcpOAuthState.delete).toHaveBeenCalledWith({ where: { state: 'state-abc' } });
    expect(prisma.mcpServerConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ accessToken: 'enc:at-1', userId: 'u1', mcpServerId: 'srv-1' }) }),
    );
  });

  it('rejects when the state belongs to a different user than the one completing it, without ever exchanging the code', async () => {
    (prisma.mcpOAuthState.findUnique as jest.Mock).mockResolvedValue(PENDING);
    const { completeMcpConnect } = await import('@/lib/mcp-connections');
    await expect(completeMcpConnect('someone-else', 'state-abc', 'code-1')).rejects.toThrow('different user');
    // Consumed either way, so the state can't be retried under the right user.
    expect(prisma.mcpOAuthState.delete).toHaveBeenCalledWith({ where: { state: 'state-abc' } });
    expect(mcpOauth.exchangeCode).not.toHaveBeenCalled();
  });

  it('rejects an expired or already-used state', async () => {
    (prisma.mcpOAuthState.findUnique as jest.Mock).mockResolvedValue(null);
    const { completeMcpConnect } = await import('@/lib/mcp-connections');
    await expect(completeMcpConnect('u1', 'gone', 'code-1')).rejects.toThrow('expired');
  });
});

describe('disconnectMcpServer', () => {
  it('deletes the local connection even when the server has no revocation endpoint', async () => {
    (prisma.mcpServerConnection.findUnique as jest.Mock).mockResolvedValue({
      id: 'conn-1',
      accessToken: 'enc:at-1',
      mcpServer: { ...SERVER, revocationEndpoint: undefined },
    });
    const { disconnectMcpServer } = await import('@/lib/mcp-connections');
    await disconnectMcpServer('u1', 'srv-1');
    expect(prisma.mcpServerConnection.delete).toHaveBeenCalledWith({ where: { userId_mcpServerId: { userId: 'u1', mcpServerId: 'srv-1' } } });
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it('revokes the refresh token (not the access token) via createSafeFetch, authenticated with the confidential client', async () => {
    (prisma.mcpServerConnection.findUnique as jest.Mock).mockResolvedValue({
      id: 'conn-1',
      accessToken: 'enc:at-1',
      refreshToken: 'enc:rt-1',
      mcpServer: SERVER,
    });
    const { disconnectMcpServer } = await import('@/lib/mcp-connections');
    await disconnectMcpServer('u1', 'srv-1');

    expect(mockCreateSafeFetch).toHaveBeenCalled();
    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockSafeFetch.mock.calls[0];
    expect(url).toBe(SERVER.revocationEndpoint);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('client-1:secret-1').toString('base64')}`);
    const body = init.body as URLSearchParams;
    expect(body.get('token')).toBe('rt-1');
    expect(body.get('token_type_hint')).toBe('refresh_token');
    expect(prisma.mcpServerConnection.delete).toHaveBeenCalled();
  });

  it('falls back to revoking the access token, with client_id in the body for a public client', async () => {
    (prisma.mcpServerConnection.findUnique as jest.Mock).mockResolvedValue({
      id: 'conn-1',
      accessToken: 'enc:at-1',
      refreshToken: null,
      mcpServer: { ...SERVER, clientSecret: null },
    });
    const { disconnectMcpServer } = await import('@/lib/mcp-connections');
    await disconnectMcpServer('u1', 'srv-1');

    const [, init] = mockSafeFetch.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
    const body = init.body as URLSearchParams;
    expect(body.get('token')).toBe('at-1');
    expect(body.get('token_type_hint')).toBe('access_token');
    expect(body.get('client_id')).toBe('client-1');
  });

  it('logs a rejected revocation rather than reading a 401 as success', async () => {
    (prisma.mcpServerConnection.findUnique as jest.Mock).mockResolvedValue({
      id: 'conn-1',
      accessToken: 'enc:at-1',
      refreshToken: 'enc:rt-1',
      mcpServer: SERVER,
    });
    mockSafeFetch.mockResolvedValue({ ok: false, status: 401 });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const { disconnectMcpServer } = await import('@/lib/mcp-connections');
      await disconnectMcpServer('u1', 'srv-1');

      expect(errorSpy.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('revocation endpoint returned 401');
      // The local row goes either way — an upstream token we cannot revoke is
      // no reason to keep a connection the user asked to remove.
      expect(prisma.mcpServerConnection.delete).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('still deletes the local connection when revocation fails', async () => {
    (prisma.mcpServerConnection.findUnique as jest.Mock).mockResolvedValue({
      id: 'conn-1',
      accessToken: 'enc:at-1',
      refreshToken: 'enc:rt-1',
      mcpServer: SERVER,
    });
    mockSafeFetch.mockRejectedValue(new Error('revocation endpoint unreachable'));

    const { disconnectMcpServer } = await import('@/lib/mcp-connections');
    await disconnectMcpServer('u1', 'srv-1');

    expect(prisma.mcpServerConnection.delete).toHaveBeenCalledWith({ where: { userId_mcpServerId: { userId: 'u1', mcpServerId: 'srv-1' } } });
  });
});

describe('recordMcpServerStatus', () => {
  it('writes the reported status onto the connection lastError', async () => {
    (prisma.mcpServer.findUnique as jest.Mock).mockResolvedValue({ id: 'srv-1' });

    const { recordMcpServerStatus } = await import('@/lib/mcp-connections');
    await recordMcpServerStatus('u1', 'sentry', 'needs-auth');

    expect(prisma.mcpServer.findUnique).toHaveBeenCalledWith({ where: { name: 'sentry' }, select: { id: true } });
    expect(prisma.mcpServerConnection.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', mcpServerId: 'srv-1' },
      data: { lastError: expect.stringContaining('needs-auth') },
    });
  });

  it('does nothing when the server name is unknown', async () => {
    (prisma.mcpServer.findUnique as jest.Mock).mockResolvedValue(null);

    const { recordMcpServerStatus } = await import('@/lib/mcp-connections');
    await recordMcpServerStatus('u1', 'ghost', 'failed');

    expect(prisma.mcpServerConnection.updateMany).not.toHaveBeenCalled();
  });
});
