import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

// POST: Claude saves a knowledge entry (called via tool use / fetch from CLI)
export async function POST(request: Request) {
  // This endpoint is called by the Claude CLI process, not by the browser.
  // We authenticate via a simple shared secret to prevent abuse.
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.KNOWLEDGE_API_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const body = await request.json();
  const { category, content, source } = body as {
    category: string;
    content: string;
    source?: string;
  };

  if (!category || !content) {
    return new Response('category and content are required', { status: 400 });
  }

  const validCategories = ['correction', 'terminology', 'product_insight', 'process'];
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

  const entry = await prisma.knowledgeEntry.create({
    data: { category, content, source },
  });

  console.log(`[knowledge] New entry saved: [${category}] ${content.slice(0, 100)}`);

  return NextResponse.json({ status: 'saved', id: entry.id });
}

// GET: List all knowledge entries (for the UI / admin)
export async function GET() {
  const entries = await prisma.knowledgeEntry.findMany({
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(entries);
}
