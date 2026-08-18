import { requireApprovedUser } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { deleteUploadedFile } from '@/lib/upload';
import { NextResponse } from 'next/server';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return auth.response;
  const user = auth.user;

  const { id } = await params;

  const isAdmin = user.role === 'admin';
  const conversation = await prisma.conversation.findFirst({
    where: isAdmin ? { id } : { id, userId: user.id },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        include: {
          attachments: {
            select: { id: true, filename: true, mimeType: true, size: true },
          },
          sentByAdmin: {
            select: { id: true, name: true },
          },
        },
      },
      flags: {
        include: {
          admin: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
      user: {
        select: { id: true, name: true, claudeToken: true },
      },
    },
  });

  if (!conversation) {
    return new Response('Not found', { status: 404 });
  }

  const isOwner = conversation.userId === user.id;
  const ownerHasClaudeToken = !!conversation.user.claudeToken;

  // Mark unseen messages as seen for the owner only
  if (isOwner) {
    await prisma.message.updateMany({
      where: { conversationId: id, seenByOwner: false },
      data: { seenByOwner: true },
    });
  }

  // Strip the owner.claudeToken before returning (it's encrypted, but we never expose it)
  const { user: ownerUser, ...rest } = conversation;
  return NextResponse.json({
    ...rest,
    user: { id: ownerUser.id, name: ownerUser.name },
    isOwner,
    isAdmin,
    ownerHasClaudeToken,
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return auth.response;
  const user = auth.user;

  const { id } = await params;

  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: user.id },
  });

  if (!conversation) {
    return new Response('Not found', { status: 404 });
  }

  // Delete uploaded files for this conversation
  const messages = await prisma.message.findMany({
    where: { conversationId: id },
    include: { attachments: true },
  });
  for (const msg of messages) {
    for (const attachment of msg.attachments) {
      await deleteUploadedFile(attachment.storagePath);
    }
  }

  await prisma.conversation.delete({
    where: { id },
  });

  return new Response(null, { status: 204 });
}
