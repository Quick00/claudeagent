import { GET } from '@/app/api/admin/conversations/route';
import { requireAdminUser } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';

jest.mock('@/lib/api-auth', () => ({ requireAdminUser: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: { conversation: { findMany: jest.fn() } },
}));

const mockAuth = requireAdminUser as jest.Mock;
const findMany = prisma.conversation.findMany as jest.Mock;

const ROW = {
  id: 'c1',
  title: 'Why is the deploy failing?',
  createdAt: new Date('2026-01-01T10:00:00.000Z'),
  updatedAt: new Date('2026-01-02T10:00:00.000Z'),
  user: { id: 'u1', name: 'Jane Doe', email: 'jane@example.com' },
  _count: { messages: 7 },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ ok: true, user: { id: 'a1', role: 'admin' } });
  findMany.mockResolvedValue([ROW]);
});

describe('GET /api/admin/conversations', () => {
  it('refuses a caller who is not an admin', async () => {
    mockAuth.mockResolvedValue({ ok: false, response: new Response('Forbidden', { status: 403 }) });

    expect((await GET()).status).toBe(403);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('returns every conversation with its owner and message count', async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        id: 'c1',
        title: 'Why is the deploy failing?',
        createdAt: '2026-01-01T10:00:00.000Z',
        updatedAt: '2026-01-02T10:00:00.000Z',
        messageCount: 7,
        user: { id: 'u1', name: 'Jane Doe', email: 'jane@example.com' },
      },
    ]);
  });

  it('lists the most recently active conversations first', async () => {
    await GET();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { updatedAt: 'desc' } }),
    );
  });
});
