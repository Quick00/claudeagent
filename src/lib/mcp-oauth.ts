import {
  discoverOAuthServerInfo,
  registerClient,
  startAuthorization,
  exchangeAuthorization,
  refreshAuthorization,
  type OAuthServerInfo,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidClientError, InvalidGrantError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { createSafeFetch } from '@/lib/mcp-url-safety';

export { InvalidClientError, InvalidGrantError };

/**
 * What `buildAuthorizationRequest`/`exchangeCode`/`refreshTokens` actually
 * need. `DiscoveredMcpServer` (below) is a superset produced by discovery;
 * `src/lib/mcp-connections.ts` also builds this shape directly from a stored
 * `McpServer` row for a connect/refresh, without re-running discovery.
 */
export interface McpAuthContext {
  authorizationServerUrl: string;
  metadata: AuthorizationServerMetadata;
  resource: string;
  scope?: string;
}

export interface DiscoveredMcpServer extends McpAuthContext {
  authorizeEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  revocationEndpoint?: string;
  tokenEndpointAuthMethod?: string;
}

function hasRevocationEndpoint(metadata: AuthorizationServerMetadata): metadata is OAuthMetadata {
  return 'revocation_endpoint' in metadata;
}

/** A published `scopes_supported` list as the space-delimited `scope` parameter (RFC 6749 §3.3). */
function joinScopes(scopes: string[] | undefined): string | undefined {
  return scopes && scopes.length > 0 ? scopes.join(' ') : undefined;
}

/** Combines RFC 9728 protected-resource discovery with RFC 8414 authorization-server metadata. */
export async function discoverMcpServer(serverUrl: string): Promise<DiscoveredMcpServer> {
  const info: OAuthServerInfo = await discoverOAuthServerInfo(serverUrl, { fetchFn: createSafeFetch() });
  const metadata = info.authorizationServerMetadata;
  if (!metadata) {
    throw new Error(`${serverUrl} did not publish OAuth authorization server metadata`);
  }

  // The SDK's `selectResourceURL` needs a full `OAuthClientProvider` we don't
  // otherwise implement, just to read one field — so this reimplements only
  // that field directly from the RFC 9728 document.
  const resource = info.resourceMetadata?.resource ?? serverUrl;

  return {
    resource,
    authorizationServerUrl: info.authorizationServerUrl,
    authorizeEndpoint: metadata.authorization_endpoint,
    tokenEndpoint: metadata.token_endpoint,
    registrationEndpoint: metadata.registration_endpoint,
    revocationEndpoint: hasRevocationEndpoint(metadata) ? metadata.revocation_endpoint : undefined,
    // The resource's own RFC 9728 `scopes_supported` is what an authorization
    // request for *this* resource should carry, and the MCP scope-selection
    // strategy (SEP-835, which the SDK's own `auth()` implements) prefers it.
    // The authorization server's RFC 8414 list is only a fallback, and it is
    // requested whole: it is the set of everything the server supports, not
    // a ranking, so taking `[0]` requested e.g. `openid` on its own and left
    // out the tool scope — every `tools/call` then failed while Settings
    // still showed CONNECTED. Whatever is chosen here is stored on the row
    // and reused verbatim for the authorize redirect and every refresh.
    scope: joinScopes(info.resourceMetadata?.scopes_supported) ?? joinScopes(metadata.scopes_supported),
    tokenEndpointAuthMethod: metadata.token_endpoint_auth_methods_supported?.[0],
    metadata,
  };
}

/** RFC 7591 dynamic client registration. Throws if the server has no `registration_endpoint`. */
export async function registerMcpClient(
  discovered: DiscoveredMcpServer,
  redirectUri: string,
): Promise<OAuthClientInformationFull> {
  if (!discovered.registrationEndpoint) {
    throw new Error('server has no registration_endpoint');
  }
  const clientMetadata: OAuthClientMetadata = {
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: discovered.tokenEndpointAuthMethod ?? 'none',
    client_name: 'Claude Agent',
    scope: discovered.scope,
  };
  return registerClient(discovered.authorizationServerUrl, {
    metadata: discovered.metadata,
    clientMetadata,
    scope: discovered.scope,
    fetchFn: createSafeFetch(),
  });
}

/** Generates the PKCE challenge and the authorization URL a user's browser is redirected to. */
export async function buildAuthorizationRequest(
  authContext: McpAuthContext,
  clientInformation: OAuthClientInformationFull,
  redirectUri: string,
  state: string,
): Promise<{ authorizationUrl: URL; codeVerifier: string }> {
  return startAuthorization(authContext.authorizationServerUrl, {
    metadata: authContext.metadata,
    clientInformation,
    redirectUrl: redirectUri,
    scope: authContext.scope,
    state,
    resource: new URL(authContext.resource),
  });
}

/** Exchanges an authorization code for tokens (authorization_code grant + PKCE verifier). */
export async function exchangeCode(
  authContext: McpAuthContext,
  clientInformation: OAuthClientInformationFull,
  authorizationCode: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<OAuthTokens> {
  return exchangeAuthorization(authContext.authorizationServerUrl, {
    metadata: authContext.metadata,
    clientInformation,
    authorizationCode,
    codeVerifier,
    redirectUri,
    resource: new URL(authContext.resource),
    fetchFn: createSafeFetch(),
  });
}

/**
 * Exchanges a refresh token for new tokens. Throws `InvalidGrantError` or
 * `InvalidClientError` when the authorization server itself rejected the
 * credential — callers use that to distinguish a dead connection from a
 * merely unreachable one.
 */
export async function refreshTokens(
  authorizationServerUrl: string,
  metadata: AuthorizationServerMetadata | undefined,
  clientInformation: OAuthClientInformationFull,
  refreshToken: string,
  resource: string,
): Promise<OAuthTokens> {
  return refreshAuthorization(authorizationServerUrl, {
    metadata,
    clientInformation,
    refreshToken,
    resource: new URL(resource),
    fetchFn: createSafeFetch(),
  });
}
