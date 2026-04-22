import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

interface GraphNode {
  id: string;
  label: string;
  category: string;
  type: 'entry' | 'topic';
}

interface GraphLink {
  source: string;
  target: string;
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

  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const topicNodes = new Set<string>();

  // Create entry nodes and topic nodes
  for (const entry of entries) {
    const label = entry.subject || (entry.content.length > 60 ? entry.content.slice(0, 57) + '...' : entry.content);
    nodes.push({
      id: entry.id,
      label,
      category: entry.category,
      type: 'entry',
    });

    const tags = entry.tags
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    for (const tag of tags) {
      // Add topic node if not seen
      const topicId = `topic:${tag}`;
      if (!topicNodes.has(tag)) {
        topicNodes.add(tag);
        nodes.push({
          id: topicId,
          label: tag,
          category: 'topic',
          type: 'topic',
        });
      }

      // Link entry to its topic
      links.push({ source: entry.id, target: topicId });
    }
  }

  return NextResponse.json({ nodes, links });
}
