import { requireApprovedUser } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET() {
  const auth = await requireApprovedUser();
  if (!auth.ok) return auth.response;
  const user = auth.user;

  const unseenFlags = await prisma.flag.findMany({
    where: {
      userId: user.id,
      status: 'RESPONDED',
      seenByUser: false,
    },
    select: {
      id: true,
      conversationId: true,
    },
  });

  const conversationIds = [...new Set(unseenFlags.map((f) => f.conversationId))];

  return NextResponse.json({
    count: unseenFlags.length,
    conversationIds,
    flags: unseenFlags,
  });
}
