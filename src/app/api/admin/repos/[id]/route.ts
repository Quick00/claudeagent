import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { removeRepo, syncRepo } from '@/lib/repo-manager';

// PATCH: Update repo description, branch (with inline sync validation), or toggle active
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
  const { description, active, defaultBranch } = body as {
    description?: string;
    active?: boolean;
    defaultBranch?: string;
  };

  const data: Record<string, unknown> = {};
  if (description !== undefined) data.description = description;
  if (active !== undefined) data.active = active;

  if (defaultBranch !== undefined) {
    const branch = String(defaultBranch).trim();
    // eslint-disable-next-line no-control-regex
    if (!branch || branch.startsWith('-') || /[\s\x00-\x1f\x7f]/.test(branch)) {
      return NextResponse.json({ error: 'Invalid branch name' }, { status: 400 });
    }

    const existing = await prisma.repository.findUnique({ where: { id } });
    if (!existing) {
      return new Response('Not found', { status: 404 });
    }

    if (branch !== existing.defaultBranch) {
      const token = process.env.GITLAB_TOKEN;
      if (!token) {
        return NextResponse.json({ error: 'GITLAB_TOKEN not configured' }, { status: 500 });
      }

      // Validate-on-save: fetch + reset to the new branch before persisting.
      // If the branch doesn't exist the fetch fails and the working tree is untouched.
      try {
        await syncRepo({
          localPath: existing.localPath,
          branch,
          token,
          gitlabUrl: existing.gitlabUrl,
        });
      } catch (err) {
        console.error(`[repos] Branch sync failed for "${branch}":`, (err as Error).message);
        return NextResponse.json(
          { error: `Branch "${branch}" not found or sync failed` },
          { status: 400 },
        );
      }

      data.lastPulledAt = new Date();
    }

    data.defaultBranch = branch;
  }

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
