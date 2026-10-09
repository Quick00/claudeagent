import { isBlockedEmail } from '@/lib/blocked-users';

describe('isBlockedEmail', () => {
  it('blocks nobody when the list is unset or empty', () => {
    expect(isBlockedEmail('someone@example.com', undefined)).toBe(false);
    expect(isBlockedEmail('someone@example.com', '')).toBe(false);
    expect(isBlockedEmail('someone@example.com', ' , ')).toBe(false);
  });

  it('never blocks a missing email', () => {
    expect(isBlockedEmail(undefined, 'a@example.com')).toBe(false);
    expect(isBlockedEmail(null, 'a@example.com')).toBe(false);
    expect(isBlockedEmail('', 'a@example.com')).toBe(false);
  });

  it('matches any entry in a comma-separated list, ignoring case and spaces', () => {
    const list = ' a@example.com , B@Example.com';
    expect(isBlockedEmail('a@example.com', list)).toBe(true);
    expect(isBlockedEmail('b@example.COM', list)).toBe(true);
    expect(isBlockedEmail('c@example.com', list)).toBe(false);
  });

  it('only matches whole addresses', () => {
    expect(isBlockedEmail('a@example.com', 'xa@example.com')).toBe(false);
    expect(isBlockedEmail('xa@example.com', 'a@example.com')).toBe(false);
  });
});
