import { POST } from '@/app/api/webhook/gitlab/route';
import { execGitPull } from '@/lib/git-pull';

jest.mock('@/lib/git-pull');

const mockExecGitPull = execGitPull as jest.Mock;

function makeRequest(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/webhook/gitlab', {
    method: 'POST',
    headers,
  });
}

describe('POST /api/webhook/gitlab', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      GITLAB_WEBHOOK_SECRET: 'test-secret',
      REPO_PATH: '/repo',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns 401 when GITLAB_WEBHOOK_SECRET is not configured', async () => {
    delete process.env.GITLAB_WEBHOOK_SECRET;
    const res = await POST(makeRequest({ 'X-Gitlab-Token': 'anything' }));
    expect(res.status).toBe(401);
  });

  it('returns 401 when X-Gitlab-Token is missing', async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 401 when X-Gitlab-Token is wrong', async () => {
    const res = await POST(makeRequest({ 'X-Gitlab-Token': 'wrong' }));
    expect(res.status).toBe(401);
  });

  it('returns 200 on successful pull', async () => {
    mockExecGitPull.mockResolvedValue({ success: true, output: 'Already up to date.\n' });

    const res = await POST(makeRequest({ 'X-Gitlab-Token': 'test-secret' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ message: 'Pull successful', output: 'Already up to date.\n' });
    expect(mockExecGitPull).toHaveBeenCalledWith('/repo');
  });

  it('returns 409 when pull is already in progress', async () => {
    mockExecGitPull.mockResolvedValue({ success: false, error: 'Pull already in progress' });

    const res = await POST(makeRequest({ 'X-Gitlab-Token': 'test-secret' }));

    expect(res.status).toBe(409);
  });

  it('returns 500 when pull fails', async () => {
    mockExecGitPull.mockResolvedValue({ success: false, error: 'merge conflict' });

    const res = await POST(makeRequest({ 'X-Gitlab-Token': 'test-secret' }));

    expect(res.status).toBe(500);
  });
});
