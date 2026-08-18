process.env.RESEND_API_KEY = 'test-key';
process.env.FROM_EMAIL = 'noreply@example.com';

import { getAdminEmails, sendNewAccountNotification } from '@/lib/email';
import { prisma } from '@/lib/prisma';

const mockSend = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: (...args: unknown[]) => mockSend(...args) },
  })),
}));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findMany: jest.fn(),
    },
  },
}));

const mockFindMany = prisma.user.findMany as jest.Mock;

describe('getAdminEmails', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns only admin addresses', async () => {
    mockFindMany.mockResolvedValue([{ email: 'a@example.com' }, { email: 'b@example.com' }]);

    await expect(getAdminEmails()).resolves.toEqual(['a@example.com', 'b@example.com']);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { role: 'admin' },
      select: { email: true },
    });
  });
});

describe('sendNewAccountNotification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({ id: 'sent' });
  });

  it('sends one separate email per admin', async () => {
    mockFindMany.mockResolvedValue([{ email: 'a@example.com' }, { email: 'b@example.com' }]);

    await sendNewAccountNotification({ name: 'New Person', email: 'new@example.com' }, true);

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@example.com' }));
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ to: 'b@example.com' }));
  });

  it('says approval is needed when the account is pending', async () => {
    mockFindMany.mockResolvedValue([{ email: 'a@example.com' }]);

    await sendNewAccountNotification({ name: 'New Person', email: 'new@example.com' }, true);

    const { subject, html } = mockSend.mock.calls[0][0];
    expect(subject).toContain('Approval needed');
    expect(html).toContain('Account Awaiting Approval');
  });

  it('reports a plain new account when approval is off', async () => {
    mockFindMany.mockResolvedValue([{ email: 'a@example.com' }]);

    await sendNewAccountNotification({ name: 'New Person', email: 'new@example.com' }, false);

    const { subject, html } = mockSend.mock.calls[0][0];
    expect(subject).toContain('New account');
    expect(html).toContain('New Account Created');
  });

  it('escapes html in the account name', async () => {
    mockFindMany.mockResolvedValue([{ email: 'a@example.com' }]);

    await sendNewAccountNotification(
      { name: '<script>alert(1)</script>', email: 'x@example.com' },
      false
    );

    expect(mockSend.mock.calls[0][0].html).not.toContain('<script>');
  });

  it('sends nothing when there are no admins', async () => {
    mockFindMany.mockResolvedValue([]);

    await sendNewAccountNotification({ name: 'New Person', email: 'new@example.com' }, true);

    expect(mockSend).not.toHaveBeenCalled();
  });
});
