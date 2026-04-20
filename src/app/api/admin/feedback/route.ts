import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
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

  const { searchParams } = new URL(request.url);
  const typeFilter = searchParams.get('type');
  const statusFilter = searchParams.get('status');

  const where: Record<string, string> = {};
  if (typeFilter && ['FEATURE_REQUEST', 'BUG'].includes(typeFilter)) {
    where.type = typeFilter;
  }
  if (statusFilter && ['TODO', 'DONE'].includes(statusFilter)) {
    where.status = statusFilter;
  }

  const posts = await prisma.feedbackPost.findMany({
    where,
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: {
      user: { select: { id: true, name: true, email: true } },
      image: { select: { id: true, filename: true } },
    },
  });

  return NextResponse.json(posts);
}
