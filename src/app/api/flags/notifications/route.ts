import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new Response('Unauthorized', { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  if (!user) {
    return new Response('User not found', { status: 404 });
  }

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
