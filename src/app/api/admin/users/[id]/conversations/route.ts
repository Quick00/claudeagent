import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new Response('Unauthorized', { status: 401 });
  }

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  if (!currentUser || currentUser.role !== 'admin') {
    return new Response('Forbidden', { status: 403 });
  }

  const { id } = await params;

  const conversations = await prisma.conversation.findMany({
    where: { userId: id },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      claudeSessionId: true,
    },
    orderBy: { updatedAt: 'desc' },
  });

  return NextResponse.json(conversations);
}
