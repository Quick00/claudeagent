import { NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/api-auth';
import { listMcpServersAdmin, registerMcpServer, toAdminMcpServerView } from '@/lib/mcp-servers-admin';

export async function GET() {
  const auth = await requireAdminUser();
  if (!auth.ok) return auth.response;

  const servers = await listMcpServersAdmin();
  return NextResponse.json(servers.map(toAdminMcpServerView));
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
    return NextResponse.json(toAdminMcpServerView(server), { status: 201 });
  } catch (err) {
    // Discovery failures — including a rejected name — are the caller's
    // (admin's) input being invalid or unreachable, not a server bug.
    return NextResponse.json({ error: (err as Error).message }, { status: 422 });
  }
}
