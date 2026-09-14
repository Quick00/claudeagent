import { NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/api-auth';
import { decrypt } from '@/lib/crypto';
import { runTier1 } from '@/lib/knowledge-verifier';
import { startTier2 } from '@/lib/knowledge-verify-run';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminUser();
  if (!auth.ok) return auth.response;
  const admin = auth.user;

  const { id } = await params;
  const { tier } = (await request.json()) as { tier?: unknown };

  if (tier === 1) {
    return NextResponse.json(await runTier1(id, admin.id));
  }

  if (tier === 2) {
    if (!admin.claudeToken) {
      return NextResponse.json({ error: 'Link your Claude account in Settings to run a full verification' }, { status: 409 });
    }
    try {
      return NextResponse.json(await startTier2(id, { id: admin.id, claudeToken: decrypt(admin.claudeToken) }));
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 409 });
    }
  }

  return NextResponse.json({ error: 'tier must be 1 or 2' }, { status: 400 });
}
