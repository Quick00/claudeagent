import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { embedText } from '@/lib/embed-text';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new Response('Unauthorized', { status: 401 });
  }

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  if (!currentUser) {
    return new Response('User not found', { status: 404 });
  }

  const { query, limit = 20 } = await request.json();
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return NextResponse.json({ entries: [] });
  }

  const isAdmin = currentUser.role === 'admin';
  const embedding = await embedText(query.trim());
  const vectorStr = `[${embedding.join(',')}]`;
  const safeLimit = Math.min(Math.max(1, Number(limit)), 50);

  const categoryFilter = isAdmin ? '' : `AND category != 'developer'`;

  const results: {
    id: string;
    subject: string;
    category: string;
    content: string;
    tags: string;
    createdAt: Date;
    updatedAt: Date;
    similarity: number;
  }[] = await prisma.$queryRawUnsafe(
    `SELECT id, subject, category, content, tags, "createdAt", "updatedAt",
            1 - (embedding <=> $1::vector) as similarity
     FROM "KnowledgeEntry"
     WHERE embedding IS NOT NULL ${categoryFilter}
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    vectorStr,
    safeLimit,
  );

  return NextResponse.json({
    entries: results.map((r) => ({
      ...r,
      similarity: Math.round(r.similarity * 100),
    })),
  });
}
