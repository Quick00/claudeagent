import { requireApprovedUser } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET() {
  const auth = await requireApprovedUser();
  if (!auth.ok) return auth.response;
  const user = auth.user;

  const conversations = await prisma.conversation.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      title: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(conversations);
}
