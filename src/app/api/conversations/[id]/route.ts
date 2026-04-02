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

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  if (!user) {
    return new Response('User not found', { status: 404 });
  }

  const { id } = await params;

  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: user.id },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!conversation) {
    return new Response('Not found', { status: 404 });
  }

  return NextResponse.json(conversation);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;

  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: user.id },
  });

  if (!conversation) {
    return new Response('Not found', { status: 404 });
  }

  await prisma.conversation.delete({
    where: { id },
  });

  return new Response(null, { status: 204 });
}
