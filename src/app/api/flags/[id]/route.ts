import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function PATCH(
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
  const { adminResponse } = (await request.json()) as { adminResponse: string };

  if (!adminResponse?.trim()) {
    return new Response('adminResponse is required', { status: 400 });
  }

  const flag = await prisma.flag.findUnique({ where: { id } });
  if (!flag) {
    return new Response('Flag not found', { status: 404 });
  }

  const updated = await prisma.flag.update({
    where: { id },
    data: {
      adminResponse,
      status: 'RESPONDED',
      adminId: currentUser.id,
      respondedAt: new Date(),
      seenByUser: false,
    },
  });

  return NextResponse.json(updated);
}
