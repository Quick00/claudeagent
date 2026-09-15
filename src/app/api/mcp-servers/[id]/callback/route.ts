import { requireApprovedUser } from '@/lib/api-auth';
import { completeMcpConnect } from '@/lib/mcp-connections';

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
  const settingsUrl = new URL('/settings', url.origin);

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
