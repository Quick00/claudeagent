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
    try {
      return NextResponse.json(await runTier1(id, admin.id));
    } catch (err) {
      // runTier1 records a terminal outcome for anything that happens during
      // the run; only a failure to even record the run reaches here. Answer
      // like the tier 2 path rather than with an unhandled 500.
      return NextResponse.json({ error: (err as Error).message }, { status: 409 });
    }
  }

  if (tier === 2) {
    // This response is held for as long as the verifier runs (up to
    // config.verificationTimeoutMs), so a reverse proxy may well close the
    // connection before it returns. That is why startTier2 refuses a second
    // concurrent run on the same entry: an admin who sees the request fail
    // and presses the button again gets a 409, not a second paid run.
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
