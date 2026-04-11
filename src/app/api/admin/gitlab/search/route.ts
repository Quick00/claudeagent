import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { config } from '@/lib/config';

// GET: Search GitLab projects
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

  if (!config.gitlabToken) {
    return Response.json({ error: 'GITLAB_TOKEN is not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  if (!query) {
    return new Response('q parameter is required', { status: 400 });
  }

  const response = await fetch(
    `https://gitlab.com/api/v4/projects?search=${encodeURIComponent(query)}&membership=true&per_page=20&order_by=last_activity_at`,
    {
      headers: {
        'PRIVATE-TOKEN': config.gitlabToken,
      },
    },
  );

  if (!response.ok) {
    const text = await response.text();
    console.error('[gitlab] Search failed:', response.status, text);
    return Response.json({ error: 'GitLab API request failed' }, { status: response.status });
  }

  const projects = await response.json();

  const results = projects.map((p: Record<string, unknown>) => ({
    id: p.id,
    name: p.name,
    nameWithNamespace: p.name_with_namespace,
    description: p.description,
    webUrl: p.web_url,
    httpUrlToRepo: p.http_url_to_repo,
    defaultBranch: p.default_branch,
    lastActivityAt: p.last_activity_at,
  }));

  return NextResponse.json(results);
}
