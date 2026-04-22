import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { embedText, findSimilarPages } from '@/lib/embeddings';
import { askLibrarian } from '@/lib/knowledge-librarian';

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.KNOWLEDGE_API_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const body = await request.json();
  const { category, content, tags, source, repositoryId, subject } = body as {
    category: string;
    content: string;
    tags?: string;
    source?: string;
    repositoryId?: string;
    subject?: string;
  };

  if (!category || !content) {
    return new Response('category and content are required', { status: 400 });
  }

  const validCategories = ['terminology', 'product_insight', 'process', 'developer'];
  if (!validCategories.includes(category)) {
    return new Response(`category must be one of: ${validCategories.join(', ')}`, { status: 400 });
  }

  // Step 1: Embed the incoming content
  let embedding: number[];
  try {
    embedding = await embedText(content);
  } catch (err) {
    console.error('[knowledge] Failed to generate embedding:', (err as Error).message);
    // Fall back to simple save without dedup
    const entry = await prisma.knowledgeEntry.create({
      data: {
        subject: subject || '',
        category,
        content,
        tags: tags || '',
        source,
        repositoryId: repositoryId || null,
      },
    });
    return NextResponse.json({ status: 'saved', id: entry.id, action: 'create', subject: subject || '' });
  }

  // Step 2: Search for similar existing pages
  const similarPages = await findSimilarPages(embedding, 5);

  // Step 3: Decide — if no similar pages, create directly; otherwise ask the librarian
  if (similarPages.length === 0) {
    const pageSubject = subject || '';
    const entry = await prisma.knowledgeEntry.create({
      data: {
        subject: pageSubject,
        category,
        content,
        tags: tags || '',
        source,
        repositoryId: repositoryId || null,
      },
    });

    const vectorStr = `[${embedding.join(',')}]`;
    await prisma.$executeRaw`
      UPDATE "KnowledgeEntry"
      SET embedding = ${vectorStr}::vector
      WHERE id = ${entry.id}
    `;

    console.log(`[knowledge] New page created: "${pageSubject}" [${category}]`);
    return NextResponse.json({
      status: 'saved',
      id: entry.id,
      action: 'create',
      subject: pageSubject,
      message: `Created new page '${pageSubject}'.`,
    });
  }

  // Step 4: Ask the librarian
  let decision;
  try {
    decision = await askLibrarian(
      content,
      category,
      subject,
      similarPages.map((p) => ({
        id: p.id,
        subject: p.subject,
        content: p.content,
        category: p.category,
        tags: p.tags,
      })),
    );
  } catch (err) {
    console.error('[knowledge] Librarian failed, saving as new:', (err as Error).message);
    const entry = await prisma.knowledgeEntry.create({
      data: {
        subject: subject || '',
        category,
        content,
        tags: tags || '',
        source,
        repositoryId: repositoryId || null,
      },
    });
    const vectorStr = `[${embedding.join(',')}]`;
    await prisma.$executeRaw`
      UPDATE "KnowledgeEntry"
      SET embedding = ${vectorStr}::vector
      WHERE id = ${entry.id}
    `;
    return NextResponse.json({ status: 'saved', id: entry.id, action: 'create', subject: subject || '' });
  }

  // Step 5: Execute the decision
  if (decision.action === 'update') {
    const validIds = similarPages.map((p) => p.id);
    if (!validIds.includes(decision.pageId)) {
      console.error(`[knowledge] Librarian returned invalid pageId: ${decision.pageId}`);
      decision = { action: 'create' as const, subject: decision.subject, content: decision.content, tags: decision.tags };
    }
  }

  if (decision.action === 'update') {
    const newEmbedding = await embedText(decision.content);
    const vectorStr = `[${newEmbedding.join(',')}]`;

    await prisma.knowledgeEntry.update({
      where: { id: decision.pageId },
      data: {
        subject: decision.subject,
        content: decision.content,
        tags: decision.tags,
        updatedAt: new Date(),
      },
    });
    await prisma.$executeRaw`
      UPDATE "KnowledgeEntry"
      SET embedding = ${vectorStr}::vector
      WHERE id = ${decision.pageId}
    `;

    console.log(`[knowledge] Updated page: "${decision.subject}" (${decision.pageId})`);
    return NextResponse.json({
      status: 'saved',
      id: decision.pageId,
      action: 'update',
      subject: decision.subject,
      message: `Updated page '${decision.subject}' — integrated your finding.`,
    });
  }

  if (decision.action === 'create') {
    const entry = await prisma.knowledgeEntry.create({
      data: {
        subject: decision.subject,
        category,
        content: decision.content,
        tags: decision.tags,
        source,
        repositoryId: repositoryId || null,
      },
    });
    const createEmbedding = await embedText(decision.content);
    const vectorStr = `[${createEmbedding.join(',')}]`;
    await prisma.$executeRaw`
      UPDATE "KnowledgeEntry"
      SET embedding = ${vectorStr}::vector
      WHERE id = ${entry.id}
    `;

    console.log(`[knowledge] New page created: "${decision.subject}" [${category}]`);
    return NextResponse.json({
      status: 'saved',
      id: entry.id,
      action: 'create',
      subject: decision.subject,
      message: `Created new page '${decision.subject}'.`,
    });
  }

  // action === 'skip'
  console.log(`[knowledge] Skipped: ${decision.reason} (covered by "${decision.coveredBy}")`);
  return NextResponse.json({
    status: 'skipped',
    action: 'skip',
    reason: decision.reason,
    message: `Already covered in '${decision.coveredBy}'.`,
  });
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
    ...(session?.user?.email ? { include: { repository: { select: { name: true } } } } : {}),
  });
  return NextResponse.json(entries);
}
