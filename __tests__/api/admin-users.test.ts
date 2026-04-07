import { GET } from '@/app/api/admin/users/route';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

jest.mock('next-auth');
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

const mockGetServerSession = getServerSession as jest.Mock;
const mockFindUnique = prisma.user.findUnique as jest.Mock;
const mockFindMany = prisma.user.findMany as jest.Mock;

describe('GET /api/admin/users', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it('returns 403 when user is not admin', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: 'user@example.com' },
    });
    mockFindUnique.mockResolvedValue({
      id: '1',
      email: 'user@example.com',
      role: 'user',
    });

    const response = await GET();

    expect(response.status).toBe(403);
  });

  it('returns user list when user is admin', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: 'admin@example.com' },
    });
    mockFindUnique.mockResolvedValue({
      id: '1',
      email: 'admin@example.com',
      role: 'admin',
    });
    const users = [
      {
        id: '1',
        name: 'Admin',
        email: 'admin@example.com',
        image: null,
        role: 'admin',
        claudeEmail: 'claude@example.com',
        createdAt: new Date('2026-01-01'),
      },
      {
        id: '2',
        name: 'Regular User',
        email: 'user@example.com',
        image: null,
        role: 'user',
        claudeEmail: null,
        createdAt: new Date('2026-02-01'),
      },
    ];
    mockFindMany.mockResolvedValue(users);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual({
      id: '1',
      name: 'Admin',
      email: 'admin@example.com',
      image: null,
      role: 'admin',
      claudeLinked: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(data[1].claudeLinked).toBe(false);
  });
});
