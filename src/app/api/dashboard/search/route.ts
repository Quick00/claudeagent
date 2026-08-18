import { requireApprovedUser } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { embedText } from '@/lib/embed-text';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return auth.response;
  const currentUser = auth.user;

  const { query, limit = 20 } = await request.json();
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return NextResponse.json({ entries: [] });
  }

  const parsed = Number(limit);
  const safeLimit = Math.min(Math.max(1, Number.isFinite(parsed) ? Math.round(parsed) : 20), 50);

  try {
    const isAdmin = currentUser.role === 'admin';
    const embedding = await embedText(query.trim());
    const vectorStr = `[${embedding.join(',')}]`;

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
  } catch (error) {
    console.error('Search failed:', error);
    return NextResponse.json(
      { error: 'search_unavailable', message: 'Search currently unavailable' },
      { status: 503 },
    );
  }
}
