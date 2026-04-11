import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { removeRepo } from '@/lib/repo-manager';

// PATCH: Update repo description or toggle active
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
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
  const body = await request.json();
  const { description, active } = body as {
    description?: string;
    active?: boolean;
  };

  const data: Record<string, unknown> = {};
  if (description !== undefined) data.description = description;
  if (active !== undefined) data.active = active;

  if (Object.keys(data).length === 0) {
    return new Response('No fields to update', { status: 400 });
  }

  const repo = await prisma.repository.update({
    where: { id },
    data,
  });

  return NextResponse.json(repo);
}

// DELETE: Remove repo and its clone
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
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

  const repo = await prisma.repository.findUnique({ where: { id } });
  if (!repo) {
    return new Response('Not found', { status: 404 });
  }

  // Remove files first — if this fails, DB stays intact
  await removeRepo(repo.localPath);

  // DB cleanup in a transaction so it's atomic
  await prisma.$transaction([
    prisma.conversation.updateMany({
      where: { repositoryId: id },
      data: { repositoryId: null },
    }),
    prisma.knowledgeEntry.updateMany({
      where: { repositoryId: id },
      data: { repositoryId: null },
    }),
    prisma.repository.delete({ where: { id } }),
  ]);

  return new Response(null, { status: 204 });
}
