import { requireAdminUser, requireApprovedUser } from '@/lib/api-auth';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

jest.mock('next-auth');
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
  },
}));

const mockGetServerSession = getServerSession as jest.Mock;
const mockFindUnique = prisma.user.findUnique as jest.Mock;

describe('requireApprovedUser', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when there is no session', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const result = await requireApprovedUser();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it('returns 404 when the session has no matching account', async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: 'ghost@example.com' } });
    mockFindUnique.mockResolvedValue(null);

    const result = await requireApprovedUser();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
  });

  it('returns 403 for a pending account', async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: 'new@example.com' } });
    mockFindUnique.mockResolvedValue({ id: 'u1', role: 'user', status: 'PENDING' });

    const result = await requireApprovedUser();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it('returns 403 for a rejected account', async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: 'nope@example.com' } });
    mockFindUnique.mockResolvedValue({ id: 'u1', role: 'user', status: 'REJECTED' });

    const result = await requireApprovedUser();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it('returns the user for an approved account', async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: 'ok@example.com' } });
    mockFindUnique.mockResolvedValue({ id: 'u1', role: 'user', status: 'APPROVED' });

    const result = await requireApprovedUser();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.id).toBe('u1');
  });
});

describe('requireAdminUser', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 403 for an approved non-admin', async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: 'user@example.com' } });
    mockFindUnique.mockResolvedValue({ id: 'u1', role: 'user', status: 'APPROVED' });

    const result = await requireAdminUser();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it('returns 403 for a pending admin', async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: 'admin@example.com' } });
    mockFindUnique.mockResolvedValue({ id: 'u1', role: 'admin', status: 'PENDING' });

    const result = await requireAdminUser();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it('returns the user for an approved admin', async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: 'admin@example.com' } });
    mockFindUnique.mockResolvedValue({ id: 'a1', role: 'admin', status: 'APPROVED' });

    const result = await requireAdminUser();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.id).toBe('a1');
  });
});
