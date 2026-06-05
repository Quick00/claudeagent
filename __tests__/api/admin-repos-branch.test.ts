import { PATCH } from '@/app/api/admin/repos/[id]/route';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { syncRepo } from '@/lib/repo-manager';

jest.mock('next-auth');
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    repository: { findUnique: jest.fn(), update: jest.fn() },
  },
}));
jest.mock('@/lib/repo-manager', () => ({
  syncRepo: jest.fn(),
  removeRepo: jest.fn(),
}));

const mockSession = getServerSession as jest.Mock;
const mockUserFind = prisma.user.findUnique as jest.Mock;
const mockRepoFind = prisma.repository.findUnique as jest.Mock;
const mockRepoUpdate = prisma.repository.update as jest.Mock;
const mockSync = syncRepo as jest.Mock;

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (body: object) =>
  new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) });

const existingRepo = {
  id: 'r1',
  name: 'web-app',
  defaultBranch: 'main',
  localPath: '/repos/123',
  gitlabUrl: 'https://gitlab.example.com/org/web-app.git',
};

describe('PATCH /api/admin/repos/[id] — defaultBranch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GITLAB_TOKEN = 'test-token';
    mockSession.mockResolvedValue({ user: { email: 'a@example.com' } });
    mockUserFind.mockResolvedValue({ id: 'a1', role: 'admin' });
    mockRepoFind.mockResolvedValue(existingRepo);
    mockRepoUpdate.mockResolvedValue({ ...existingRepo, defaultBranch: 'develop' });
  });

  it('400 on empty branch name, no sync attempted', async () => {
    const res = await PATCH(req({ defaultBranch: '   ' }), params('r1'));
    expect(res.status).toBe(400);
    expect(mockSync).not.toHaveBeenCalled();
    expect(mockRepoUpdate).not.toHaveBeenCalled();
  });

  it('400 on branch name containing whitespace, no sync attempted', async () => {
    const res = await PATCH(req({ defaultBranch: 'feat ure' }), params('r1'));
    expect(res.status).toBe(400);
    expect(mockSync).not.toHaveBeenCalled();
    expect(mockRepoUpdate).not.toHaveBeenCalled();
  });

  it('syncs the new branch and persists defaultBranch + lastPulledAt', async () => {
    mockSync.mockResolvedValue(undefined);
    const res = await PATCH(req({ defaultBranch: 'develop' }), params('r1'));
    expect(res.status).toBe(200);
    expect(mockSync).toHaveBeenCalledWith({
      localPath: '/repos/123',
      branch: 'develop',
      token: 'test-token',
      gitlabUrl: 'https://gitlab.example.com/org/web-app.git',
    });
    expect(mockRepoUpdate).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: expect.objectContaining({
        defaultBranch: 'develop',
        lastPulledAt: expect.any(Date),
      }),
    });
  });

  it('400 when sync fails, no DB write', async () => {
    mockSync.mockRejectedValue(new Error('fatal: couldn\'t find remote ref nope'));
    const res = await PATCH(req({ defaultBranch: 'nope' }), params('r1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('nope');
    expect(mockRepoUpdate).not.toHaveBeenCalled();
  });

  it('same branch value: no sync, still 200', async () => {
    mockRepoUpdate.mockResolvedValue(existingRepo);
    const res = await PATCH(req({ defaultBranch: 'main' }), params('r1'));
    expect(res.status).toBe(200);
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('404 when repo does not exist', async () => {
    mockRepoFind.mockResolvedValue(null);
    const res = await PATCH(req({ defaultBranch: 'develop' }), params('r1'));
    expect(res.status).toBe(404);
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('500 when GITLAB_TOKEN is not set', async () => {
    delete process.env.GITLAB_TOKEN;
    const res = await PATCH(req({ defaultBranch: 'develop' }), params('r1'));
    expect(res.status).toBe(500);
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('existing description-only update still works without touching branch logic', async () => {
    mockRepoUpdate.mockResolvedValue(existingRepo);
    const res = await PATCH(req({ description: 'new desc' }), params('r1'));
    expect(res.status).toBe(200);
    expect(mockSync).not.toHaveBeenCalled();
    expect(mockRepoUpdate).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { description: 'new desc' },
    });
  });
});
