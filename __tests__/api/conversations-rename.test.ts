import { PATCH } from '@/app/api/conversations/[id]/route';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

jest.mock('next-auth');
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    conversation: { findFirst: jest.fn(), update: jest.fn() },
  },
}));
jest.mock('@/lib/upload', () => ({ deleteUploadedFile: jest.fn() }));

const mockSession = getServerSession as jest.Mock;
const mockUserFind = prisma.user.findUnique as jest.Mock;
const mockConvFind = prisma.conversation.findFirst as jest.Mock;
const mockConvUpdate = prisma.conversation.update as jest.Mock;

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (body: unknown) =>
  new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) });

const asUser = (role = 'user') => {
  mockSession.mockResolvedValue({ user: { email: 'u@example.com' } });
  mockUserFind.mockResolvedValue({ id: 'u1', role, status: 'APPROVED' });
};

describe('PATCH /api/conversations/[id] — rename', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConvUpdate.mockImplementation(async ({ data }) => ({ id: 'c1', title: data.title }));
  });

  it('401 when not authenticated', async () => {
    mockSession.mockResolvedValue(null);
    expect((await PATCH(req({ title: 'x' }), params('c1'))).status).toBe(401);
  });

  it('renames a conversation the caller owns', async () => {
    asUser();
    mockConvFind.mockResolvedValue({ id: 'c1', userId: 'u1' });

    const res = await PATCH(req({ title: '  Renamed  ' }), params('c1'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({ title: 'Renamed' }));
    expect(mockConvUpdate).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { title: 'Renamed' },
      select: expect.anything(),
    });
  });

  it('404s for a conversation the caller does not own, without updating', async () => {
    asUser();
    // The route scopes its lookup to the caller, so someone else's row is simply not found.
    mockConvFind.mockResolvedValue(null);

    expect((await PATCH(req({ title: 'x' }), params('c1'))).status).toBe(404);
    expect(mockConvUpdate).not.toHaveBeenCalled();
  });

  // An admin may read any conversation (GET widens for them), but renaming
  // someone else's is not a moderation action — it would silently rewrite what
  // the owner sees.
  it('does not let an admin rename a conversation they do not own', async () => {
    asUser('admin');
    mockConvFind.mockResolvedValue(null);

    expect((await PATCH(req({ title: 'x' }), params('c1'))).status).toBe(404);
    expect(mockConvFind).toHaveBeenCalledWith({ where: { id: 'c1', userId: 'u1' } });
    expect(mockConvUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['not a string', 42],
    ['missing', undefined],
  ])('400s on %s title', async (_label, title) => {
    asUser();
    mockConvFind.mockResolvedValue({ id: 'c1', userId: 'u1' });

    expect((await PATCH(req({ title }), params('c1'))).status).toBe(400);
    expect(mockConvUpdate).not.toHaveBeenCalled();
  });

  it('caps an overlong title rather than storing it unbounded', async () => {
    asUser();
    mockConvFind.mockResolvedValue({ id: 'c1', userId: 'u1' });

    await PATCH(req({ title: 'a'.repeat(500) }), params('c1'));

    const stored = mockConvUpdate.mock.calls[0][0].data.title as string;
    expect(stored.length).toBeLessThanOrEqual(200);
  });
});
