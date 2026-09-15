import { NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';

/**
 * Every conversation in the system, for `/admin/conversations`. The rows are
 * small and the panel filters them in the browser, the same way the feedback
 * and flags panels do — so this deliberately returns the whole list rather
 * than a page of it. Revisit that when the table gets slow, not before.
 */
export async function GET() {
  const auth = await requireAdminUser();
  if (!auth.ok) return auth.response;

  const conversations = await prisma.conversation.findMany({
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      user: { select: { id: true, name: true, email: true } },
      _count: { select: { messages: true } },
    },
  });

  return NextResponse.json(
    conversations.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messageCount: c._count.messages,
      user: c.user,
    })),
  );
}
