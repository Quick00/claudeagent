import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET() {
  const [entries, conversations, messages] = await Promise.all([
    prisma.knowledgeEntry.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.conversation.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, createdAt: true },
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
    stats: {
      totalEntries: entries.length,
      totalConversations: conversations.length,
      totalMessages: messages,
      categories,
    },
    tags,
    entries: entries.slice(0, 50),
    entriesByDay,
    recentConversations: conversations.slice(0, 10),
  });
}
