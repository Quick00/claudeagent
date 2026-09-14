import { NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/api-auth';
import { updateEntry, type EntryPatch } from '@/lib/knowledge-admin';

const KEYS: Array<keyof EntryPatch> = ['subject', 'content', 'tags', 'category', 'kind', 'status'];

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminUser();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await request.json()) as Record<string, unknown>;
  const patch: EntryPatch = {};
  for (const key of KEYS) {
    if (typeof body[key] === 'string') (patch as Record<string, string>)[key] = body[key] as string;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  try {
    await updateEntry(id, patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
