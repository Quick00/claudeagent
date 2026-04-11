import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { cloneRepo, removeRepo } from '@/lib/repo-manager';
import path from 'path';

// GET: List all repositories
export async function GET() {
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

  const repos = await prisma.repository.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      description: true,
      gitlabProjectId: true,
      gitlabUrl: true,
      defaultBranch: true,
      localPath: true,
      lastPulledAt: true,
      active: true,
      createdAt: true,
    },
  });

  return NextResponse.json(repos);
}

// POST: Add a new repository (clones it)
export async function POST(request: Request) {
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

  const body = await request.json();
  const { name, description, gitlabProjectId, gitlabUrl, defaultBranch } = body as {
    name: string;
    description: string;
    gitlabProjectId: number;
    gitlabUrl: string;
    defaultBranch: string;
  };

  if (!name || !description || !gitlabProjectId || !gitlabUrl) {
    return new Response('name, description, gitlabProjectId, and gitlabUrl are required', { status: 400 });
  }

  const existing = await prisma.repository.findUnique({
    where: { gitlabProjectId },
  });
  if (existing) {
    return Response.json({ error: 'This GitLab project has already been added' }, { status: 409 });
  }

  const localPath = path.join(config.reposDir, String(gitlabProjectId));

  const repo = await prisma.repository.create({
    data: {
      name,
      description,
      gitlabProjectId,
      gitlabUrl,
      defaultBranch: defaultBranch || 'main',
      localPath,
      active: false,
    },
  });

  cloneRepo({
    gitlabUrl,
    localPath,
    branch: defaultBranch || 'main',
    token: config.gitlabToken,
  })
    .then(async () => {
      await prisma.repository.update({
        where: { id: repo.id },
        data: { active: true, lastPulledAt: new Date() },
      });
      console.log(`[repos] Cloned and activated: ${name} (${gitlabProjectId})`);
    })
    .catch(async (err) => {
      console.error(`[repos] Failed to clone ${name}:`, (err as Error).message);
      await removeRepo(localPath);
    });

  return NextResponse.json({ ...repo, status: 'cloning' }, { status: 201 });
}
