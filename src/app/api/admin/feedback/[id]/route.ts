import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { sendFeedbackDoneEmail } from '@/lib/email';

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
  const { status } = (await request.json()) as { status: string };

  if (!status || !['TODO', 'DONE'].includes(status)) {
    return NextResponse.json({ error: 'status must be TODO or DONE' }, { status: 400 });
  }

  const post = await prisma.feedbackPost.findUnique({
    where: { id },
    include: { user: { select: { email: true } } },
  });
  if (!post) {
    return NextResponse.json({ error: 'Feedback post not found' }, { status: 404 });
  }

  const updated = await prisma.feedbackPost.update({
    where: { id },
    data: { status },
    include: {
      user: { select: { id: true, name: true, email: true } },
      image: { select: { id: true, filename: true } },
    },
  });

  if (status === 'DONE' && post.status !== 'DONE') {
    sendFeedbackDoneEmail(
      post.user.email,
      post.title,
      post.type as 'FEATURE_REQUEST' | 'BUG'
    ).catch(() => {});
  }

  return NextResponse.json(updated);
}
