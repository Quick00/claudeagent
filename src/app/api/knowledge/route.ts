import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { embedText } from '@/lib/embeddings';

// POST: Claude saves a knowledge entry (called via tool use / fetch from CLI)
export async function POST(request: Request) {
  // This endpoint is called by the Claude CLI process, not by the browser.
  // We authenticate via a simple shared secret to prevent abuse.
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.KNOWLEDGE_API_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const body = await request.json();
  const { category, content, tags, source, repositoryId } = body as {
    category: string;
    content: string;
    tags?: string;
    source?: string;
    repositoryId?: string;
  };

  if (!category || !content) {
    return new Response('category and content are required', { status: 400 });
  }

  const validCategories = ['correction', 'terminology', 'product_insight', 'process', 'developer'];
  if (!validCategories.includes(category)) {
    return new Response(`category must be one of: ${validCategories.join(', ')}`, { status: 400 });
  }

  // Check for duplicates — don't save if very similar content already exists
  const existing = await prisma.knowledgeEntry.findMany({
    where: { category },
  });
  const isDuplicate = existing.some(
    (e) => e.content.toLowerCase().trim() === content.toLowerCase().trim()
  );
  if (isDuplicate) {
    return NextResponse.json({ status: 'skipped', reason: 'duplicate' });
  }

  let embedding: number[] | null = null;
  try {
    embedding = await embedText(content);
  } catch (err) {
    console.error('[knowledge] Failed to generate embedding:', (err as Error).message);
  }

  const entry = await prisma.knowledgeEntry.create({
    data: { category, content, tags: tags || '', source, repositoryId: repositoryId || null },
  });

  if (embedding) {
    const vectorStr = `[${embedding.join(',')}]`;
    await prisma.$executeRaw`
      UPDATE "KnowledgeEntry"
      SET embedding = ${vectorStr}::vector
      WHERE id = ${entry.id}
    `;
  }

  console.log(`[knowledge] New entry saved: [${category}] ${content.slice(0, 100)}`);

  return NextResponse.json({ status: 'saved', id: entry.id });
}

// GET: List knowledge entries (developer entries only visible to admins)
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
    orderBy: { createdAt: 'desc' },
    ...(session?.user?.email ? { include: { repository: { select: { name: true } } } } : {}),
  });
  return NextResponse.json(entries);
}
