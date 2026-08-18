import { GET } from '@/app/api/conversations/[id]/route';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

jest.mock('next-auth');
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    conversation: { findFirst: jest.fn() },
    message: { updateMany: jest.fn() },
  },
}));

const mockSession = getServerSession as jest.Mock;
const mockUser = prisma.user.findUnique as jest.Mock;
const mockConv = prisma.conversation.findFirst as jest.Mock;
const mockMsgUpdate = prisma.message.updateMany as jest.Mock;

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('GET /api/conversations/[id] — ownership extensions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMsgUpdate.mockResolvedValue({ count: 0 });
  });

  it('returns isOwner=true, isAdmin=false, ownerHasClaudeToken=true for the owner', async () => {
    mockSession.mockResolvedValue({ user: { email: 'owner@example.com' } });
    mockUser.mockResolvedValue({ id: 'u-owner', role: 'user', status: 'APPROVED', claudeToken: 'enc' });
    mockConv.mockResolvedValue({
      id: 'c1', userId: 'u-owner', title: 't', claudeSessionId: 's',
      messages: [], flags: [],
      user: { id: 'u-owner', name: 'Owner', claudeToken: 'enc' },
    });

    const res = await GET(new Request('http://x'), params('c1'));
    const body = await res.json();
    expect(body.isOwner).toBe(true);
    expect(body.isAdmin).toBe(false);
    expect(body.ownerHasClaudeToken).toBe(true);
  });

  it('returns isOwner=false, isAdmin=true for an admin viewing another user', async () => {
    mockSession.mockResolvedValue({ user: { email: 'admin@example.com' } });
    mockUser.mockResolvedValue({ id: 'u-admin', role: 'admin', status: 'APPROVED', claudeToken: null });
    mockConv.mockResolvedValue({
      id: 'c1', userId: 'u-other', title: 't', claudeSessionId: 's',
      messages: [], flags: [],
      user: { id: 'u-other', name: 'Other', claudeToken: 'enc' },
    });

    const res = await GET(new Request('http://x'), params('c1'));
    const body = await res.json();
    expect(body.isOwner).toBe(false);
    expect(body.isAdmin).toBe(true);
    expect(body.ownerHasClaudeToken).toBe(true);
  });

  it('marks all unseen messages as seen when owner reads', async () => {
    mockSession.mockResolvedValue({ user: { email: 'owner@example.com' } });
    mockUser.mockResolvedValue({ id: 'u-owner', role: 'user', status: 'APPROVED', claudeToken: 'enc' });
    mockConv.mockResolvedValue({
      id: 'c1', userId: 'u-owner', title: 't', claudeSessionId: 's',
      messages: [], flags: [],
      user: { id: 'u-owner', name: 'Owner', claudeToken: 'enc' },
    });

    await GET(new Request('http://x'), params('c1'));

    expect(mockMsgUpdate).toHaveBeenCalledWith({
      where: { conversationId: 'c1', seenByOwner: false },
      data: { seenByOwner: true },
    });
  });

  it('does NOT mark messages seen when admin reads someone else\u2019s conversation', async () => {
    mockSession.mockResolvedValue({ user: { email: 'admin@example.com' } });
    mockUser.mockResolvedValue({ id: 'u-admin', role: 'admin', status: 'APPROVED', claudeToken: null });
    mockConv.mockResolvedValue({
      id: 'c1', userId: 'u-other', title: 't', claudeSessionId: 's',
      messages: [], flags: [],
      user: { id: 'u-other', name: 'Other', claudeToken: 'enc' },
    });

    await GET(new Request('http://x'), params('c1'));

    expect(mockMsgUpdate).not.toHaveBeenCalled();
  });
});
