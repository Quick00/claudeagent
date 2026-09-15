import { requireApprovedUser } from '@/lib/api-auth';
import { disconnectMcpServer } from '@/lib/mcp-connections';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  await disconnectMcpServer(auth.user.id, id);
  return new Response(null, { status: 204 });
}
