import { PATCH } from '@/app/api/admin/users/route';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

jest.mock('next-auth');
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  },
}));

const mockGetServerSession = getServerSession as jest.Mock;
const mockFindUnique = prisma.user.findUnique as jest.Mock;
const mockUpdate = prisma.user.update as jest.Mock;

function signedInAsAdmin(id = 'admin-1') {
  mockGetServerSession.mockResolvedValue({ user: { email: 'admin@example.com' } });
  mockFindUnique.mockResolvedValue({
    id,
    email: 'admin@example.com',
    role: 'admin',
    status: 'APPROVED',
  });
}

function patchRequest(body: unknown) {
  return new Request('http://localhost/api/admin/users', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/admin/users — approval', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdate.mockResolvedValue({ id: 'u2', role: 'user', status: 'APPROVED' });
  });

  it('returns 403 for a non-admin', async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: 'user@example.com' } });
    mockFindUnique.mockResolvedValue({ id: 'u1', role: 'user', status: 'APPROVED' });

    const response = await PATCH(patchRequest({ userId: 'u2', status: 'APPROVED' }));

    expect(response.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('approves a pending account and records who approved it', async () => {
    signedInAsAdmin();

    const response = await PATCH(patchRequest({ userId: 'u2', status: 'APPROVED' }));

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u2' },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedAt: expect.any(Date),
          approvedById: 'admin-1',
        }),
      })
    );
  });

  it('rejects an account without keeping approval details', async () => {
    signedInAsAdmin();
    mockUpdate.mockResolvedValue({ id: 'u2', role: 'user', status: 'REJECTED' });

    await PATCH(patchRequest({ userId: 'u2', status: 'REJECTED' }));

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'REJECTED',
          approvedAt: null,
          approvedById: null,
        }),
      })
    );
  });

  it('refuses an unknown status', async () => {
    signedInAsAdmin();

    const response = await PATCH(patchRequest({ userId: 'u2', status: 'BANNED' }));

    expect(response.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('refuses to change your own account', async () => {
    signedInAsAdmin('admin-1');

    const response = await PATCH(patchRequest({ userId: 'admin-1', status: 'REJECTED' }));

    expect(response.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('refuses a request that changes nothing', async () => {
    signedInAsAdmin();

    const response = await PATCH(patchRequest({ userId: 'u2' }));

    expect(response.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('still updates roles on their own', async () => {
    signedInAsAdmin();
    mockUpdate.mockResolvedValue({ id: 'u2', role: 'admin', status: 'APPROVED' });

    const response = await PATCH(patchRequest({ userId: 'u2', role: 'admin' }));

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: 'admin' } })
    );
  });

  it('refuses an invalid role', async () => {
    signedInAsAdmin();

    const response = await PATCH(patchRequest({ userId: 'u2', role: 'superuser' }));

    expect(response.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
