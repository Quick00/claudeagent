import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { encrypt } from '@/lib/crypto';
import { discoverMcpServer, registerMcpClient } from '@/lib/mcp-oauth';
import { assertSafeMcpUrl } from '@/lib/mcp-url-safety';
import type { McpServer } from '@prisma/client';

/** The fixed redirect URI every server sees — never taken from user or admin input. */
export function mcpCallbackUrl(serverId: string): string {
  const base = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  return `${base}/api/mcp-servers/${serverId}/callback`;
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * A server's `name` becomes both its `mcpServers` key in the CLI config and
 * its `mcp__<name>__` tool-name prefix, so it has to be safe to drop
 * straight into that JSON key and can't collide with the one server that's
 * always present.
 */
function assertValidServerName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new Error('Server name must use only lowercase letters, numbers, and hyphens, and start with a letter or number');
  }
  if (name === 'knowledge') {
    throw new Error('"knowledge" is reserved for the built-in knowledge server');
  }
}

export function listMcpServersAdmin(): Promise<McpServer[]> {
  return prisma.mcpServer.findMany({ orderBy: { createdAt: 'desc' } });
}

/**
 * The shape every admin-facing MCP route responds with. An explicit
 * projection rather than the spread of a Prisma row: the row also carries
 * the encrypted `clientSecret` and `registrationAccessToken`, which the
 * admin UI never reads and which have no business in a browser response.
 * Includes the fixed callback URI the admin registers on the third-party
 * server's side for MANUAL registration.
 */
export function toAdminMcpServerView(server: McpServer) {
  return {
    id: server.id,
    name: server.name,
    serverUrl: server.serverUrl,
    transport: server.transport,
    resource: server.resource,
    authorizationServerUrl: server.authorizationServerUrl,
    authorizeEndpoint: server.authorizeEndpoint,
    tokenEndpoint: server.tokenEndpoint,
    registrationEndpoint: server.registrationEndpoint,
    revocationEndpoint: server.revocationEndpoint,
    scope: server.scope,
    tokenEndpointAuthMethod: server.tokenEndpointAuthMethod,
    clientId: server.clientId,
    hasClientSecret: server.clientSecret !== null,
    clientSecretExpiresAt: server.clientSecretExpiresAt,
    registrationMode: server.registrationMode,
    enabled: server.enabled,
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
    callbackUrl: mcpCallbackUrl(server.id),
  };
}

export type AdminMcpServerView = ReturnType<typeof toAdminMcpServerView>;

/**
 * Registers a new server. Tries dynamic client registration first; a server
 * with no `registration_endpoint`, or one whose registration attempt fails,
 * is saved as MANUAL with no client credentials — the admin fills those in
 * with `saveManualMcpServerClient`.
 */
export async function registerMcpServer(input: {
  name: string;
  serverUrl: string;
  transport?: 'HTTP' | 'SSE';
  createdByUserId: string;
}): Promise<McpServer> {
  assertValidServerName(input.name);
  const discovered = await discoverMcpServer(input.serverUrl);

  // The callback URL is keyed by server id, but the id doesn't exist until
  // the row is created — so registration always targets the row's own id,
  // computed the same way here as everywhere else via `mcpCallbackUrl`.
  const placeholderId = randomUUID();
  let clientId: string | null = null;
  let clientSecret: string | null = null;
  let clientSecretExpiresAt: Date | null = null;
  const registrationAccessToken: string | null = null;
  let registrationMode: 'DYNAMIC' | 'MANUAL' = 'MANUAL';
  let tokenEndpointAuthMethod = discovered.tokenEndpointAuthMethod;

  if (discovered.registrationEndpoint) {
    try {
      const clientInfo = await registerMcpClient(discovered, mcpCallbackUrl(placeholderId));
      clientId = clientInfo.client_id;
      clientSecret = clientInfo.client_secret ? encrypt(clientInfo.client_secret) : null;
      clientSecretExpiresAt = clientInfo.client_secret_expires_at
        ? new Date(clientInfo.client_secret_expires_at * 1000)
        : null;
      // The registration response is authoritative for the auth method
      // (RFC 7591 §3.2.1): the server may assign one other than the one
      // requested, and `authContextFromServer` later hands the stored value
      // to the SDK as the *only* supported method. Persisting the
      // discovery guess instead meant e.g. Basic against a server that had
      // assigned `client_secret_post`, so every token request came back
      // `invalid_client` — which the refresh path reads as a revoked DCR
      // client and answers with yet another registration.
      tokenEndpointAuthMethod = clientInfo.token_endpoint_auth_method ?? tokenEndpointAuthMethod;
      registrationMode = 'DYNAMIC';
    } catch (err) {
      console.error(`[mcp-servers-admin] Dynamic registration failed for ${input.serverUrl}:`, (err as Error).message);
    }
  }

  return prisma.mcpServer.create({
    data: {
      id: placeholderId,
      name: input.name,
      serverUrl: input.serverUrl,
      transport: input.transport ?? 'HTTP',
      resource: discovered.resource,
      authorizationServerUrl: discovered.authorizationServerUrl,
      authorizeEndpoint: discovered.authorizeEndpoint,
      tokenEndpoint: discovered.tokenEndpoint,
      registrationEndpoint: discovered.registrationEndpoint,
      revocationEndpoint: discovered.revocationEndpoint,
      scope: discovered.scope,
      tokenEndpointAuthMethod,
      clientId,
      clientSecret,
      clientSecretExpiresAt,
      registrationAccessToken,
      registrationMode,
      enabled: false,
      createdByUserId: input.createdByUserId,
    },
  });
}

export async function saveManualMcpServerClient(
  id: string,
  input: { clientId: string; clientSecret?: string; authorizeEndpoint?: string; tokenEndpoint?: string; revocationEndpoint?: string },
): Promise<McpServer> {
  // Discovery already runs every URL it fetches through assertSafeMcpUrl —
  // an admin typing an endpoint in by hand for a MANUAL server needs the
  // same check, since these are fetched (or built into an authorize
  // redirect) exactly the way a discovered endpoint is.
  for (const url of [input.authorizeEndpoint, input.tokenEndpoint, input.revocationEndpoint]) {
    if (url) await assertSafeMcpUrl(url);
  }

  return prisma.mcpServer.update({
    where: { id },
    data: {
      clientId: input.clientId,
      // Left alone when omitted, like the endpoints below: the PATCH body
      // is partial, and writing `null` here turned an endpoint-only edit
      // into a silent downgrade of a confidential client to a public one —
      // with no way back, since the manual form only shows while the
      // server has no client id at all.
      ...(input.clientSecret ? { clientSecret: encrypt(input.clientSecret) } : {}),
      ...(input.authorizeEndpoint ? { authorizeEndpoint: input.authorizeEndpoint } : {}),
      ...(input.tokenEndpoint ? { tokenEndpoint: input.tokenEndpoint } : {}),
      ...(input.revocationEndpoint ? { revocationEndpoint: input.revocationEndpoint } : {}),
      registrationMode: 'MANUAL',
    },
  });
}

export function setMcpServerEnabled(id: string, enabled: boolean): Promise<McpServer> {
  return prisma.mcpServer.update({ where: { id }, data: { enabled } });
}

export function deleteMcpServer(id: string): Promise<void> {
  return prisma.mcpServer.delete({ where: { id } }).then(() => undefined);
}

/**
 * Re-runs DCR for a server whose stored client was rejected as invalid —
 * DCR-issued credentials can expire or be revoked server-side, and every
 * user's connection would otherwise fail the same way until an admin
 * manually re-added the server.
 */
export async function reRegisterMcpServerClient(server: McpServer): Promise<McpServer> {
  if (server.registrationMode !== 'DYNAMIC') {
    throw new Error(`${server.name} is registered MANUALLY; re-registration only applies to DYNAMIC servers`);
  }
  const discovered = await discoverMcpServer(server.serverUrl);
  const clientInfo = await registerMcpClient(discovered, mcpCallbackUrl(server.id));
  // Discovery was re-run to register against, so what it found is the
  // server's current truth; the freshly assigned auth method in particular
  // must land alongside the new client, or the retry that follows
  // authenticates the new credentials the old client's way.
  return prisma.mcpServer.update({
    where: { id: server.id },
    data: {
      resource: discovered.resource,
      authorizationServerUrl: discovered.authorizationServerUrl,
      authorizeEndpoint: discovered.authorizeEndpoint,
      tokenEndpoint: discovered.tokenEndpoint,
      registrationEndpoint: discovered.registrationEndpoint,
      revocationEndpoint: discovered.revocationEndpoint,
      scope: discovered.scope,
      tokenEndpointAuthMethod: clientInfo.token_endpoint_auth_method ?? discovered.tokenEndpointAuthMethod,
      clientId: clientInfo.client_id,
      clientSecret: clientInfo.client_secret ? encrypt(clientInfo.client_secret) : null,
      clientSecretExpiresAt: clientInfo.client_secret_expires_at ? new Date(clientInfo.client_secret_expires_at * 1000) : null,
    },
  });
}
