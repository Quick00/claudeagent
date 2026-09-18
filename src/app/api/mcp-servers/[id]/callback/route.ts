import { requireApprovedUser } from '@/lib/api-auth';
import { abandonMcpConnect, completeMcpConnect } from '@/lib/mcp-connections';
import { appBaseUrl } from '@/lib/mcp-servers-admin';

/**
 * Reached only via a redirect from the authorization server, but the user's
 * own browser still carries their session cookie — `requireApprovedUser`
 * guards it the same as any other route.
 */
export async function GET(request: Request, _context: { params: Promise<{ id: string }> }) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const settingsUrl = new URL('/settings', appBaseUrl());

  // RFC 6749 §4.1.2.1: a declined or refused authorization comes back with
  // `error` (and usually `error_description`) in place of `code`. Surfacing
  // the server's reason beats "missing state or code", and the pending
  // state is spent either way — nothing else would ever delete its row.
  if (error) {
    if (state) await abandonMcpConnect(auth.user.id, state);
    const description = url.searchParams.get('error_description');
    settingsUrl.searchParams.set('mcp_error', description ? `${error}: ${description}` : error);
    return Response.redirect(settingsUrl, 307);
  }

  if (!state || !code) {
    settingsUrl.searchParams.set('mcp_error', 'missing state or code');
    return Response.redirect(settingsUrl, 307);
  }

  try {
    await completeMcpConnect(auth.user.id, state, code);
  } catch (err) {
    settingsUrl.searchParams.set('mcp_error', (err as Error).message);
  }
  return Response.redirect(settingsUrl, 307);
}
