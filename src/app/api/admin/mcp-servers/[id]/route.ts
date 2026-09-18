import { NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/api-auth';
import { saveManualMcpServerClient, setMcpServerEnabled, setMcpServerDescription, deleteMcpServer, toAdminMcpServerView } from '@/lib/mcp-servers-admin';
import { config } from '@/lib/config';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = await request.json();
  if ('enabled' in body) {
    // Coercion reads the string "false" as true, enabling a server meant to be switched off.
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
    }
    return NextResponse.json(toAdminMcpServerView(await setMcpServerEnabled(id, body.enabled)));
  }

  if ('description' in body) {
    const { description } = body as { description: unknown };
    if (description !== null && typeof description !== 'string') {
      return NextResponse.json({ error: 'description must be text' }, { status: 400 });
    }
    const trimmed = description?.trim() ?? '';
    if (trimmed.length > config.mcpServerDescriptionMaxLength) {
      return NextResponse.json(
        { error: `description must be at most ${config.mcpServerDescriptionMaxLength} characters` },
        { status: 400 },
      );
    }
    return NextResponse.json(toAdminMcpServerView(await setMcpServerDescription(id, trimmed || null)));
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
