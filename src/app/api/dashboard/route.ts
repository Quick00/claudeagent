import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET() {
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

  const isAdmin = currentUser.role === 'admin';
  const conversationWhere = isAdmin ? {} : { userId: currentUser.id };

  const [entries, conversations, messages] = await Promise.all([
    prisma.knowledgeEntry.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.conversation.findMany({
      where: conversationWhere,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    }),
    prisma.message.count(),
  ]);

  // Category counts
  const categories: Record<string, number> = {};
  for (const e of entries) {
    categories[e.category] = (categories[e.category] || 0) + 1;
  }

  // Tag counts
  const tagCounts: Record<string, number> = {};
  for (const e of entries) {
    const tags = e.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    for (const tag of tags) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }

  // Sort tags by count descending
  const tags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ tag, count }));

  // Entries per day (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentEntries = entries.filter((e) => new Date(e.createdAt) >= thirtyDaysAgo);
  const entriesByDay: Record<string, number> = {};
  for (const e of recentEntries) {
    const day = new Date(e.createdAt).toISOString().split('T')[0];
    entriesByDay[day] = (entriesByDay[day] || 0) + 1;
  }

  return NextResponse.json({
    isAdmin,
    stats: {
      totalEntries: entries.length,
      totalConversations: conversations.length,
      totalMessages: messages,
      categories,
    },
    tags,
    entries: entries.slice(0, 50),
    entriesByDay,
    recentConversations: conversations.slice(0, 10).map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      userName: c.user.name,
    })),
  });
}
