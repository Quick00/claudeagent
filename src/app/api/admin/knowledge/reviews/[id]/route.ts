import { NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/api-auth';
import { resolveReview } from '@/lib/knowledge-reviews';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminUser();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const { action } = (await request.json()) as { action?: unknown };
  if (action !== 'accept' && action !== 'dismiss') {
    return NextResponse.json({ error: 'action must be accept or dismiss' }, { status: 400 });
  }

  try {
    await resolveReview(id, action, auth.user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
