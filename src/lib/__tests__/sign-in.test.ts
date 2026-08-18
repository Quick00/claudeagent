import { applySignIn } from '@/lib/sign-in';
import { prisma } from '@/lib/prisma';
import { getRequireUserApproval } from '@/lib/settings';
import { sendNewAccountNotification } from '@/lib/email';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));
jest.mock('@/lib/settings', () => ({
  getRequireUserApproval: jest.fn(),
}));
jest.mock('@/lib/email', () => ({
  sendNewAccountNotification: jest.fn(),
}));

const mockFindUnique = prisma.user.findUnique as jest.Mock;
const mockUpsert = prisma.user.upsert as jest.Mock;
const mockGetRequireApproval = getRequireUserApproval as jest.Mock;
const mockNotify = sendNewAccountNotification as jest.Mock;

const account = { email: 'new@example.com', name: 'New Person' };

describe('applySignIn', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNotify.mockResolvedValue(undefined);
    mockUpsert.mockImplementation(({ create }) => ({
      id: 'u1',
      ...create,
    }));
  });

  it('creates a pending account when approval is required', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockGetRequireApproval.mockResolvedValue(true);

    const result = await applySignIn(account);

    expect(result.allowed).toBe(true);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ email: account.email, status: 'PENDING' }),
      })
    );
  });

  it('creates an approved account when approval is switched off', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockGetRequireApproval.mockResolvedValue(false);

    await applySignIn(account);

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: 'APPROVED' }),
      })
    );
  });

  it('tells admins a new account needs approval', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockGetRequireApproval.mockResolvedValue(true);

    await applySignIn(account);

    expect(mockNotify).toHaveBeenCalledWith(
      { name: account.name, email: account.email },
      true
    );
  });

  it('tells admins about a new account even when approval is off', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockGetRequireApproval.mockResolvedValue(false);

    await applySignIn(account);

    expect(mockNotify).toHaveBeenCalledWith(expect.anything(), false);
  });

  it('does not email admins when an existing user signs in again', async () => {
    mockFindUnique.mockResolvedValue({ id: 'u1', email: account.email, status: 'APPROVED' });
    mockGetRequireApproval.mockResolvedValue(true);

    const result = await applySignIn(account);

    expect(result.allowed).toBe(true);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('blocks a rejected account without touching the record', async () => {
    mockFindUnique.mockResolvedValue({ id: 'u1', email: account.email, status: 'REJECTED' });
    mockGetRequireApproval.mockResolvedValue(true);

    const result = await applySignIn(account);

    expect(result).toEqual({ allowed: false, user: null });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('still signs the user in when the notification email fails', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockGetRequireApproval.mockResolvedValue(false);
    mockNotify.mockRejectedValue(new Error('resend down'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await applySignIn(account);

    expect(result.allowed).toBe(true);
    consoleError.mockRestore();
  });

  it('does not overwrite a stored image when the provider sends none', async () => {
    mockFindUnique.mockResolvedValue({ id: 'u1', email: account.email, status: 'APPROVED' });
    mockGetRequireApproval.mockResolvedValue(false);

    await applySignIn(account);

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { name: account.name } })
    );
  });
});
