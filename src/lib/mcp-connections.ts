import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { encrypt, decrypt } from '@/lib/crypto';
import { config } from '@/lib/config';
import {
  buildAuthorizationRequest,
  exchangeCode,
  refreshTokens,
  InvalidClientError,
  InvalidGrantError,
  type McpAuthContext,
} from '@/lib/mcp-oauth';
import { mcpCallbackUrl, reRegisterMcpServerClient } from '@/lib/mcp-servers-admin';
import { createSafeFetch } from '@/lib/mcp-url-safety';
import type { McpServer, Prisma } from '@prisma/client';

export interface SessionMcpEntry {
  name: string;
  transport: 'HTTP' | 'SSE';
  url: string;
  accessToken: string;
}
export interface DroppedServer {
  name: string;
  reason: string;
}

const STATE_TTL_MS = 5 * 60 * 1000;
const REFRESH_LOCK_TIMEOUT_MS = 15000;

function clientInformationFrom(server: McpServer) {
  return {
    client_id: server.clientId!,
    client_secret: server.clientSecret ? decrypt(server.clientSecret) : undefined,
    redirect_uris: [mcpCallbackUrl(server.id)],
  };
}

/**
 * Builds the OAuth context for a server from its stored row rather than
 * re-running discovery on every connect/refresh — which is also what makes
 * a MANUAL server's admin-entered endpoint overrides actually take effect,
 * instead of being silently ignored in favor of a fresh guess.
 */
function authContextFromServer(server: McpServer): McpAuthContext {
  return {
    authorizationServerUrl: server.authorizationServerUrl,
    resource: server.resource,
    scope: server.scope ?? undefined,
    metadata: {
      issuer: server.authorizationServerUrl,
      authorization_endpoint: server.authorizeEndpoint,
      token_endpoint: server.tokenEndpoint,
      revocation_endpoint: server.revocationEndpoint ?? undefined,
      response_types_supported: ['code'],
      // Without this the SDK's `selectClientAuthMethod` sees no supported
      // methods and defaults a confidential client to `client_secret_basic`,
      // so a server that wants `client_secret_post` rejects every token
      // request with `invalid_client`.
      token_endpoint_auth_methods_supported: server.tokenEndpointAuthMethod ? [server.tokenEndpointAuthMethod] : undefined,
    },
  };
}

export async function listMcpServersForUser(userId: string) {
  const [servers, connections] = await Promise.all([
    prisma.mcpServer.findMany({ where: { enabled: true }, orderBy: { name: 'asc' } }),
    prisma.mcpServerConnection.findMany({ where: { userId } }),
  ]);
  const byServerId = new Map(connections.map((c) => [c.mcpServerId, c]));
  return servers.map((server) => {
    const connection = byServerId.get(server.id);
    return {
      id: server.id,
      name: server.name,
      connectionStatus: connection ? (connection.status as 'CONNECTED' | 'ERROR') : ('NOT_CONNECTED' as const),
      lastError: connection?.lastError ?? null,
    };
  });
}

export async function startMcpConnect(userId: string, serverId: string): Promise<{ authorizationUrl: string }> {
  const server = await prisma.mcpServer.findUniqueOrThrow({ where: { id: serverId } });
  if (!server.enabled || !server.clientId) {
    throw new Error(`${server.name} is not ready to connect to yet`);
  }
  const state = randomBytes(32).toString('base64url');
  const { authorizationUrl, codeVerifier } = await buildAuthorizationRequest(
    authContextFromServer(server),
    clientInformationFrom(server),
    mcpCallbackUrl(server.id),
    state,
  );
  await prisma.mcpOAuthState.create({
    data: { state, codeVerifier, userId, mcpServerId: server.id, expiresAt: new Date(Date.now() + STATE_TTL_MS) },
  });
  return { authorizationUrl: authorizationUrl.toString() };
}

/**
 * `userId` is the signed-in user completing the callback, checked against
 * the state's recorded owner — an authorization code from one user's flow
 * can't be redeemed under a different user's session, even though the
 * state value itself is already unguessable.
 */
export async function completeMcpConnect(userId: string, state: string, code: string): Promise<{ serverId: string }> {
  const pending = await prisma.mcpOAuthState.findUnique({ where: { state } });
  // Deleted immediately whether or not it's usable, so a state value can
  // never be replayed even by a request that otherwise fails below.
  if (pending) await prisma.mcpOAuthState.delete({ where: { state } });
  if (!pending || pending.expiresAt.getTime() < Date.now()) {
    throw new Error('authorization request expired or was already used');
  }
  if (pending.userId !== userId) {
    throw new Error('this authorization request belongs to a different user');
  }

  const server = await prisma.mcpServer.findUniqueOrThrow({ where: { id: pending.mcpServerId } });
  const tokens = await exchangeCode(
    authContextFromServer(server),
    clientInformationFrom(server),
    code,
    pending.codeVerifier,
    mcpCallbackUrl(server.id),
  );

  await prisma.mcpServerConnection.upsert({
    where: { userId_mcpServerId: { userId: pending.userId, mcpServerId: server.id } },
    create: {
      userId: pending.userId,
      mcpServerId: server.id,
      accessToken: encrypt(tokens.access_token),
      refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
      scope: tokens.scope,
      status: 'CONNECTED',
    },
    update: {
      accessToken: encrypt(tokens.access_token),
      refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
      scope: tokens.scope,
      status: 'CONNECTED',
      lastError: null,
    },
  });

  return { serverId: server.id };
}

export async function disconnectMcpServer(userId: string, serverId: string): Promise<void> {
  const connection = await prisma.mcpServerConnection.findUnique({
    where: { userId_mcpServerId: { userId, mcpServerId: serverId } },
    include: { mcpServer: true },
  });
  if (!connection) return;

  const tokenToRevoke = connection.refreshToken ?? connection.accessToken;
  if (connection.mcpServer.revocationEndpoint && tokenToRevoke) {
    try {
      const { client_id, client_secret } = clientInformationFrom(connection.mcpServer);
      const body = new URLSearchParams({
        token: decrypt(tokenToRevoke),
        token_type_hint: connection.refreshToken ? 'refresh_token' : 'access_token',
      });
      const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
      if (client_secret) {
        headers.Authorization = `Basic ${Buffer.from(`${client_id}:${client_secret}`).toString('base64')}`;
      } else {
        body.set('client_id', client_id);
      }
      const res = await createSafeFetch()(connection.mcpServer.revocationEndpoint, { method: 'POST', headers, body });
      // A rejected revocation answers with a status, not a thrown error, so
      // without this an upstream token that is still live reads as revoked.
      if (!res.ok) throw new Error(`revocation endpoint returned ${res.status}`);
    } catch (err) {
      console.error(`[mcp-connections] Revocation failed for ${connection.mcpServer.name}:`, (err as Error).message);
    }
  }

  await prisma.mcpServerConnection.delete({ where: { userId_mcpServerId: { userId, mcpServerId: serverId } } });
}

function isFreshEnough(expiresAt: Date | null): boolean {
  return expiresAt === null || expiresAt.getTime() - Date.now() > config.mcpTokenRefreshMarginMs;
}

type RefreshResult = { ok: true; accessToken: string } | { ok: false; error: Error };

/**
 * Thrown out of the refresh transaction (never caught inside it) when the
 * server rejected our stored DCR client and needs re-registering. Carries
 * the server row so the caller can re-register it once the transaction's
 * lock has been released.
 */
class NeedsReRegistrationError extends Error {
  constructor(public readonly server: McpServer) {
    super(`${server.name} needs client re-registration`);
  }
}

/**
 * Thrown when a connection's access token is past its expiry and the server
 * never issued a refresh token. Classified alongside the OAuth rejections so
 * the connection is marked `ERROR` and offers "Reconnect" in Settings, rather
 * than handing back the expired token on every turn forever.
 */
class NoRefreshTokenError extends Error {
  constructor() {
    super('access token expired and no refresh token is available to renew it');
  }
}

/**
 * Re-checks freshness under the row's `SELECT ... FOR UPDATE` lock and, if
 * still stale, refreshes and persists the new tokens. `serverOverride` is
 * passed on the retry after re-registration, so a second `InvalidClientError`
 * from the freshly-registered client is reported rather than looping.
 */
async function runRefreshInTransaction(
  tx: Prisma.TransactionClient,
  connectionId: string,
  serverOverride?: McpServer,
): Promise<string> {
  const rows = await tx.$queryRaw<Array<{
    id: string;
    accessToken: string | null;
    refreshToken: string | null;
    expiresAt: Date | null;
    mcpServerId: string;
  }>>`
    SELECT id, "accessToken", "refreshToken", "expiresAt", "mcpServerId" FROM "McpServerConnection" WHERE id = ${connectionId} FOR UPDATE
  `;
  const row = rows[0];
  if (!row) throw new Error('connection no longer exists');

  // Re-check under the lock: a concurrent transaction holding this same
  // row may have already refreshed it while this one waited its turn.
  if (isFreshEnough(row.expiresAt)) {
    if (!row.accessToken) throw new Error('no usable token for this connection');
    return decrypt(row.accessToken);
  }
  if (!row.refreshToken) throw new NoRefreshTokenError();

  const server = serverOverride ?? (await tx.mcpServer.findUniqueOrThrow({ where: { id: row.mcpServerId } }));
  const refreshToken = decrypt(row.refreshToken);
  const doRefresh = () =>
    refreshTokens(
      server.authorizationServerUrl,
      authContextFromServer(server).metadata,
      clientInformationFrom(server),
      refreshToken,
      server.resource,
    );

  let tokens;
  try {
    tokens = await doRefresh();
  } catch (err) {
    if (!serverOverride && err instanceof InvalidClientError && server.registrationMode === 'DYNAMIC') {
      // The server rejected our stored client — DCR credentials can expire
      // or be revoked independently of any single user's token. Signal the
      // caller to re-register once outside this transaction, rather than
      // every user's connection failing the same way until an admin
      // manually re-adds the server. Nothing has been written yet, so
      // letting this transaction roll back is safe.
      throw new NeedsReRegistrationError(server);
    }
    // Includes InvalidGrantError, an InvalidClientError with no
    // re-registration available (a MANUAL server, or a retry after one
    // already happened), and plain network failures — classified by the
    // caller once the transaction has unwound.
    throw err;
  }

  await tx.mcpServerConnection.update({
    where: { id: connectionId },
    data: {
      accessToken: encrypt(tokens.access_token),
      refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : row.refreshToken,
      expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
      status: 'CONNECTED',
      lastError: null,
    },
  });
  return tokens.access_token;
}

/**
 * Refreshes and persists a connection's tokens under a `SELECT ... FOR
 * UPDATE` row lock, so two sessions for the same user can't both use the
 * same refresh token — some servers rotate and invalidate it on use, which
 * would otherwise fail whichever request lost the race. The lock is held
 * only for the refresh HTTP call itself; at this app's scale — occasional
 * refreshes, not a high-throughput API — that's a fine trade for correctness
 * over a lease-based scheme, but it does need a longer-than-default
 * transaction timeout.
 *
 * Re-registering a DCR client happens in a second, separate transaction:
 * the row lock from the first attempt is released before the (slow, external)
 * re-registration call runs, and re-acquired afterwards to retry. A status
 * write for a server-rejected credential, and the re-registration write
 * itself, both happen strictly *outside* any transaction that's about to
 * throw — a write made inside a callback that then throws would be rolled
 * back along with everything else in it.
 */
async function refreshAndPersist(connectionId: string): Promise<RefreshResult> {
  try {
    let accessToken: string;
    try {
      accessToken = await prisma.$transaction((tx) => runRefreshInTransaction(tx, connectionId), {
        timeout: REFRESH_LOCK_TIMEOUT_MS,
      });
    } catch (err) {
      if (!(err instanceof NeedsReRegistrationError)) throw err;
      const server = await reRegisterMcpServerClient(err.server);
      accessToken = await prisma.$transaction((tx) => runRefreshInTransaction(tx, connectionId, server), {
        timeout: REFRESH_LOCK_TIMEOUT_MS,
      });
    }

    return { ok: true, accessToken };
  } catch (err) {
    if (err instanceof InvalidGrantError || err instanceof InvalidClientError || err instanceof NoRefreshTokenError) {
      try {
        await prisma.mcpServerConnection.update({
          where: { id: connectionId },
          data: { status: 'ERROR', lastError: (err as Error).message },
        });
      } catch {
        // Best-effort: the caller already has the real error to report via `dropped`.
      }
    }
    return { ok: false, error: err as Error };
  }
}

function decryptAccessToken(accessToken: string | null): RefreshResult {
  try {
    if (!accessToken) throw new Error('connection has no access token');
    return { ok: true, accessToken: decrypt(accessToken) };
  } catch (err) {
    return { ok: false, error: err as Error };
  }
}

export async function getUsableConnectionsForSession(userId: string): Promise<{ entries: SessionMcpEntry[]; dropped: DroppedServer[] }> {
  const connections = await prisma.mcpServerConnection.findMany({
    where: { userId, status: 'CONNECTED', mcpServer: { enabled: true } },
    include: { mcpServer: true },
  });

  const entries: SessionMcpEntry[] = [];
  const dropped: DroppedServer[] = [];

  for (const connection of connections) {
    const result: RefreshResult = isFreshEnough(connection.expiresAt)
      ? decryptAccessToken(connection.accessToken)
      : await refreshAndPersist(connection.id);

    if (result.ok) {
      entries.push({
        name: connection.mcpServer.name,
        transport: connection.mcpServer.transport as 'HTTP' | 'SSE',
        url: connection.mcpServer.serverUrl,
        accessToken: result.accessToken,
      });
    } else {
      dropped.push({ name: connection.mcpServer.name, reason: result.error.message });
    }
  }

  return { entries, dropped };
}

/**
 * Records a status the Claude CLI reported for a live MCP connection (not
 * one this app dropped itself — see `dropped` above for that path) onto
 * `lastError`, so it surfaces in Settings without needing prod log access.
 */
export async function recordMcpServerStatus(userId: string, serverName: string, status: string): Promise<void> {
  const server = await prisma.mcpServer.findUnique({ where: { name: serverName }, select: { id: true } });
  if (!server) return;
  await prisma.mcpServerConnection.updateMany({
    where: { userId, mcpServerId: server.id },
    data: { lastError: `Claude reported this connection as "${status}" during a chat turn` },
  });
}
