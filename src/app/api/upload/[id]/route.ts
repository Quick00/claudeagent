import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { readFile } from 'fs/promises';

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
    return new Response('Not found', { status: 404 });
  }

  const { id } = await params;

  const attachment = await prisma.attachment.findUnique({
    where: { id },
    include: {
      message: {
        include: {
          conversation: { select: { userId: true } },
        },
      },
    },
  });

  if (!attachment) {
    return new Response('Not found', { status: 404 });
  }

  // Access check: conversation owner or admin
  if (attachment.message?.conversation) {
    const isOwner = attachment.message.conversation.userId === user.id;
    const isAdmin = user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return new Response('Forbidden', { status: 403 });
    }
  }

  try {
    const fileBuffer = await readFile(attachment.storagePath);
    return new Response(fileBuffer, {
      headers: {
        'Content-Type': attachment.mimeType,
        'Content-Length': String(attachment.size),
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch {
    return new Response('File not found', { status: 404 });
  }
}
