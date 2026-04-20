import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

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
  if (!title?.trim() || title.trim().length > 200) {
    return NextResponse.json({ error: 'title is required and must be 200 characters or fewer' }, { status: 400 });
  }
  if (!description?.trim() || description.trim().length > 5000) {
    return NextResponse.json({ error: 'description is required and must be 5000 characters or fewer' }, { status: 400 });
  }

  try {
    const post = await prisma.$transaction(async (tx) => {
      if (imageId) {
        const attachment = await tx.attachment.findUnique({
          where: { id: imageId },
          include: { feedbackPost: true },
        });
        if (!attachment) {
          throw new Error('ATTACHMENT_NOT_FOUND');
        }
        if (attachment.feedbackPost) {
          throw new Error('ATTACHMENT_ALREADY_USED');
        }
      }

      return tx.feedbackPost.create({
        data: {
          type,
          title: title.trim(),
          description: description.trim(),
          userId: user.id,
          imageId: imageId || null,
        },
      });
    });

    return NextResponse.json(post, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === 'ATTACHMENT_NOT_FOUND') {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 400 });
    }
    if (err instanceof Error && err.message === 'ATTACHMENT_ALREADY_USED') {
      return NextResponse.json({ error: 'Image is already attached to another post' }, { status: 409 });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'Image is already attached to another post' }, { status: 409 });
    }
    throw err;
  }
}
