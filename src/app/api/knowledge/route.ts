import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { KNOWLEDGE_CATEGORIES, saveKnowledge } from '@/lib/knowledge-save';

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.KNOWLEDGE_API_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const body = (await request.json()) as {
    category?: string;
    content?: string;
    tags?: string;
    subject?: string;
    provenanceKey?: string;
    basedOn?: unknown;
  };

  if (!body.category || !body.content) {
    return new Response('category and content are required', { status: 400 });
  }
  if (!KNOWLEDGE_CATEGORIES.includes(body.category as (typeof KNOWLEDGE_CATEGORIES)[number])) {
    return new Response(`category must be one of: ${KNOWLEDGE_CATEGORIES.join(', ')}`, { status: 400 });
  }

  const basedOn = Array.isArray(body.basedOn)
    ? body.basedOn.filter((p): p is string => typeof p === 'string').slice(0, 50)
    : undefined;

  const result = await saveKnowledge({
    category: body.category,
    content: body.content,
    tags: body.tags,
    subject: body.subject,
    provenanceKey: typeof body.provenanceKey === 'string' && body.provenanceKey ? body.provenanceKey : undefined,
    basedOn,
  });

  return NextResponse.json(result);
}

export async function GET() {
  const session = await getServerSession(authOptions);
  let isAdmin = false;
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });
    isAdmin = user?.role === 'admin';
  }

  const where = isAdmin ? {} : { category: { not: 'developer' } };
  const entries = await prisma.knowledgeEntry.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
  });
  return NextResponse.json(entries);
}
