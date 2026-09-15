import { NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/api-auth';
import { listMcpServersAdmin, registerMcpServer, mcpCallbackUrl } from '@/lib/mcp-servers-admin';
import type { McpServer } from '@prisma/client';

// The admin UI needs to display this fixed URI for MANUAL registration
// (the admin registers it as the redirect URI on the third-party server's
// side), so every server the admin-facing routes return carries it.
function withCallbackUrl(server: McpServer) {
  return { ...server, callbackUrl: mcpCallbackUrl(server.id) };
}

export async function GET() {
  const auth = await requireAdminUser();
  if (!auth.ok) return auth.response;

  const servers = await listMcpServersAdmin();
  return NextResponse.json(servers.map(withCallbackUrl));
}

export async function POST(request: Request) {
  const auth = await requireAdminUser();
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const { name, serverUrl, transport } = body as { name?: string; serverUrl?: string; transport?: 'HTTP' | 'SSE' };
  if (!name || !serverUrl) {
    return NextResponse.json({ error: 'name and serverUrl are required' }, { status: 400 });
  }

  try {
    const server = await registerMcpServer({ name, serverUrl, transport, createdByUserId: auth.user.id });
    return NextResponse.json(withCallbackUrl(server), { status: 201 });
  } catch (err) {
    // Discovery failures — including a rejected name — are the caller's
    // (admin's) input being invalid or unreachable, not a server bug.
    return NextResponse.json({ error: (err as Error).message }, { status: 422 });
  }
}
