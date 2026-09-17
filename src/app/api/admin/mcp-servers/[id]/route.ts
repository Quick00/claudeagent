import { NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/api-auth';
import { saveManualMcpServerClient, setMcpServerEnabled, deleteMcpServer, toAdminMcpServerView } from '@/lib/mcp-servers-admin';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = await request.json();
  if ('enabled' in body) {
    return NextResponse.json(toAdminMcpServerView(await setMcpServerEnabled(id, Boolean(body.enabled))));
  }

  const { clientId, clientSecret, authorizeEndpoint, tokenEndpoint, revocationEndpoint } = body as {
    clientId?: string;
    clientSecret?: string;
    authorizeEndpoint?: string;
    tokenEndpoint?: string;
    revocationEndpoint?: string;
  };
  if (!clientId) {
    return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  }
  return NextResponse.json(
    toAdminMcpServerView(
      await saveManualMcpServerClient(id, { clientId, clientSecret, authorizeEndpoint, tokenEndpoint, revocationEndpoint }),
    ),
  );
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  await deleteMcpServer(id);
  return new Response(null, { status: 204 });
}
