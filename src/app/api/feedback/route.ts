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

  const { type, title, description, imageId } = (await request.json()) as {
    type: string;
    title: string;
    description: string;
    imageId?: string;
  };

  if (!type || !['FEATURE_REQUEST', 'BUG'].includes(type)) {
    return NextResponse.json({ error: 'type must be FEATURE_REQUEST or BUG' }, { status: 400 });
  }
  if (!title?.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }
  if (!description?.trim()) {
    return NextResponse.json({ error: 'description is required' }, { status: 400 });
  }

  if (imageId) {
    const attachment = await prisma.attachment.findUnique({ where: { id: imageId } });
    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 400 });
    }
  }

  const post = await prisma.feedbackPost.create({
    data: {
      type,
      title: title.trim(),
      description: description.trim(),
      userId: user.id,
      imageId: imageId || null,
    },
  });

  return NextResponse.json(post, { status: 201 });
}
