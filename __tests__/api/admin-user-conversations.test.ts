import { GET } from '@/app/api/admin/users/[id]/conversations/route';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

jest.mock('next-auth');
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    conversation: { findMany: jest.fn() },
  },
}));

const mockSession = getServerSession as jest.Mock;
const mockUserFind = prisma.user.findUnique as jest.Mock;
const mockConvFindMany = prisma.conversation.findMany as jest.Mock;

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('GET /api/admin/users/[id]/conversations', () => {
  beforeEach(() => jest.clearAllMocks());

  it('401 when not authenticated', async () => {
    mockSession.mockResolvedValue(null);
    const res = await GET(new Request('http://x'), params('u1'));
    expect(res.status).toBe(401);
  });

  it('403 when not admin', async () => {
    mockSession.mockResolvedValue({ user: { email: 'x@x' } });
    mockUserFind.mockResolvedValue({ id: 'u1', role: 'user' });
    const res = await GET(new Request('http://x'), params('u1'));
    expect(res.status).toBe(403);
  });

  it('returns conversations for the requested user when caller is admin', async () => {
    mockSession.mockResolvedValue({ user: { email: 'a@x' } });
    mockUserFind.mockResolvedValue({ id: 'a1', role: 'admin' });
    mockConvFindMany.mockResolvedValue([
      { id: 'c1', title: 'Hello', updatedAt: new Date('2026-04-13'), claudeSessionId: 's' },
    ]);
    const res = await GET(new Request('http://x'), params('u-target'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body[0].id).toBe('c1');
    expect(mockConvFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u-target' },
    }));
  });
});
