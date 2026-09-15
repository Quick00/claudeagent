import { NextResponse } from 'next/server';
import { requireApprovedUser } from '@/lib/api-auth';
import { listMcpServersForUser } from '@/lib/mcp-connections';

export async function GET() {
  const auth = await requireApprovedUser();
  if (!auth.ok) return auth.response;

  return NextResponse.json(await listMcpServersForUser(auth.user.id));
}
