import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

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

  if (!process.env.GITLAB_TOKEN) {
    return NextResponse.json({ error: 'GITLAB_TOKEN is not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  const url = query
    ? `https://gitlab.com/api/v4/projects?search=${encodeURIComponent(query)}&membership=true&per_page=100&order_by=last_activity_at`
    : `https://gitlab.com/api/v4/projects?membership=true&per_page=100&order_by=last_activity_at`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'PRIVATE-TOKEN': process.env.GITLAB_TOKEN },
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return NextResponse.json({ error: 'GitLab API request timed out' }, { status: 504 });
    }
    return NextResponse.json({ error: 'Failed to reach GitLab API' }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text();
    console.error('[gitlab] Search failed:', response.status, text);
    return NextResponse.json({ error: 'GitLab API request failed' }, { status: response.status });
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
