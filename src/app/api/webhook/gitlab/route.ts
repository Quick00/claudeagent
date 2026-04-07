import { NextResponse } from 'next/server';
import { execGitPull } from '@/lib/git-pull';

export async function POST(request: Request) {
  const token = request.headers.get('X-Gitlab-Token');
  const secret = process.env.GITLAB_WEBHOOK_SECRET;

  if (!secret || !token || token !== secret) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const repoPath = process.env.REPO_PATH;
  if (!repoPath) {
    return NextResponse.json({ error: 'REPO_PATH not configured' }, { status: 500 });
  }

  const result = await execGitPull(repoPath);

  if (!result.success) {
    if (result.error === 'Pull already in progress') {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ message: 'Pull successful', output: result.output });
}
