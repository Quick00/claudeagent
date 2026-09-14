import { NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/api-auth';
import { buildAttention } from '@/lib/knowledge-attention';
import { createPinnedEntry } from '@/lib/knowledge-admin';

export async function GET() {
  const auth = await requireAdminUser();
  if (!auth.ok) return auth.response;
  return NextResponse.json(await buildAttention());
}

export async function POST(request: Request) {
  const auth = await requireAdminUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as { subject?: unknown; content?: unknown; category?: unknown; tags?: unknown };
  if (typeof body.subject !== 'string' || !body.subject.trim() || typeof body.content !== 'string' || !body.content.trim() || typeof body.category !== 'string') {
    return NextResponse.json({ error: 'subject, content and category are required' }, { status: 400 });
  }

  try {
    const id = await createPinnedEntry({
      subject: body.subject.trim(),
      content: body.content.trim(),
      category: body.category,
      tags: typeof body.tags === 'string' ? body.tags : '',
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
