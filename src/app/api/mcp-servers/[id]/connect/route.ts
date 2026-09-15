import { NextResponse } from 'next/server';
import { requireApprovedUser } from '@/lib/api-auth';
import { startMcpConnect } from '@/lib/mcp-connections';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    return NextResponse.json(await startMcpConnect(auth.user.id, id));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 422 });
  }
}
