import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
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

  const { conversationId, reason } = (await request.json()) as {
    conversationId: string;
    reason?: string;
  };

  if (!conversationId) {
    return new Response('conversationId is required', { status: 400 });
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId: user.id },
  });
  if (!conversation) {
    return new Response('Conversation not found', { status: 404 });
  }

  const existing = await prisma.flag.findFirst({
    where: { conversationId, userId: user.id, status: 'PENDING' },
  });
  if (existing) {
    return new Response('A pending flag already exists for this conversation', { status: 409 });
  }

  const flag = await prisma.flag.create({
    data: {
      conversationId,
      userId: user.id,
      reason: reason || '',
    },
  });

  return NextResponse.json(flag, { status: 201 });
}

export async function GET() {
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

  const flags = await prisma.flag.findMany({
    orderBy: [
      { status: 'asc' },
      { createdAt: 'desc' },
    ],
    include: {
      conversation: {
        select: { id: true, title: true },
      },
      user: {
        select: { id: true, name: true, email: true },
      },
      admin: {
        select: { id: true, name: true },
      },
    },
  });

  return NextResponse.json(flags);
}
