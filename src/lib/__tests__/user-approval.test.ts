import { isUserStatus, resolveSignIn, USER_STATUS } from '@/lib/user-approval';

describe('resolveSignIn', () => {
  it('creates a pending account when approval is required', () => {
    expect(resolveSignIn(null, true)).toEqual({
      allowed: true,
      status: USER_STATUS.pending,
      notifyAdmins: true,
    });
  });

  it('creates an approved account when approval is not required', () => {
    expect(resolveSignIn(null, false)).toEqual({
      allowed: true,
      status: USER_STATUS.approved,
      notifyAdmins: true,
    });
  });

  it('turns away a rejected account instead of resetting it to pending', () => {
    expect(resolveSignIn(USER_STATUS.rejected, true)).toEqual({
      allowed: false,
      status: USER_STATUS.rejected,
      notifyAdmins: false,
    });
  });

  it('lets a pending account sign in so it can reach the waiting screen', () => {
    expect(resolveSignIn(USER_STATUS.pending, true)).toEqual({
      allowed: true,
      status: USER_STATUS.pending,
      notifyAdmins: false,
    });
  });

  it('does not notify admins again for an existing approved account', () => {
    expect(resolveSignIn(USER_STATUS.approved, true)).toEqual({
      allowed: true,
      status: USER_STATUS.approved,
      notifyAdmins: false,
    });
  });

  it('leaves an existing approved account approved when the setting is switched on', () => {
    expect(resolveSignIn(USER_STATUS.approved, true).status).toBe(USER_STATUS.approved);
  });
});

describe('isUserStatus', () => {
  it('accepts the three known statuses', () => {
    expect(isUserStatus('PENDING')).toBe(true);
    expect(isUserStatus('APPROVED')).toBe(true);
    expect(isUserStatus('REJECTED')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isUserStatus('approved')).toBe(false);
    expect(isUserStatus('')).toBe(false);
    expect(isUserStatus(undefined)).toBe(false);
    expect(isUserStatus(null)).toBe(false);
  });
});
