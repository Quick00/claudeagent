import { describe, expect, test } from '@jest/globals';
import {
  ROUTES,
  SECTIONS,
  isActiveHref,
  sectionIdForPathname,
  visibleSections,
} from '../navigation';

describe('ROUTES', () => {
  test('builds a chat href from a conversation id', () => {
    expect(ROUTES.chat('abc123')).toBe('/chat/abc123');
  });

  test('chat() with no id is the new-chat route', () => {
    expect(ROUTES.chat()).toBe('/chat');
  });

  test('exposes the knowledge and admin landing routes', () => {
    expect(ROUTES.knowledgeMap).toBe('/knowledge/map');
    expect(ROUTES.knowledgeDashboard).toBe('/knowledge/dashboard');
    expect(ROUTES.adminUsers).toBe('/admin/users');
    expect(ROUTES.settings).toBe('/settings');
  });
});

describe('sectionIdForPathname', () => {
  test.each([
    ['/chat', 'chat'],
    ['/chat/abc123', 'chat'],
    ['/knowledge/map', 'knowledge'],
    ['/knowledge/dashboard', 'knowledge'],
    ['/admin/users', 'admin'],
    ['/admin/flags', 'admin'],
    ['/settings', 'settings'],
  ])('maps %s to the %s section', (pathname, expected) => {
    expect(sectionIdForPathname(pathname)).toBe(expected);
  });

  test('returns null for a pathname outside the shell', () => {
    expect(sectionIdForPathname('/login')).toBeNull();
  });

  test('does not match a section on a prefix that is not a path boundary', () => {
    expect(sectionIdForPathname('/chatter')).toBeNull();
  });
});

describe('isActiveHref', () => {
  test('an exact match is active', () => {
    expect(isActiveHref('/admin/users', '/admin/users')).toBe(true);
  });

  test('a nested path activates its parent href', () => {
    expect(isActiveHref('/chat', '/chat/abc123')).toBe(true);
  });

  test('a sibling path is not active', () => {
    expect(isActiveHref('/admin/users', '/admin/flags')).toBe(false);
  });

  test('a shared string prefix that is not a path boundary is not active', () => {
    expect(isActiveHref('/chat', '/chatter')).toBe(false);
  });
});

describe('visibleSections', () => {
  test('hides admin-only sections from a plain user', () => {
    const ids = visibleSections('user').map((s) => s.id);
    expect(ids).not.toContain('admin');
    expect(ids).toContain('chat');
  });

  test('shows every section to an admin', () => {
    const ids = visibleSections('admin').map((s) => s.id);
    expect(ids).toEqual(SECTIONS.map((s) => s.id));
  });
});

describe('SECTIONS', () => {
  test('every section id round-trips through sectionIdForPathname', () => {
    for (const section of SECTIONS) {
      expect(sectionIdForPathname(section.href)).toBe(section.id);
    }
  });

  test('admin children carry the badge keys the rail renders', () => {
    const admin = SECTIONS.find((s) => s.id === 'admin');
    const badges = admin?.children?.map((c) => c.badge).filter(Boolean);
    expect(badges).toEqual(expect.arrayContaining(['pendingFlags', 'pendingFeedback']));
  });

  test('settings has no child navigation', () => {
    expect(SECTIONS.find((s) => s.id === 'settings')?.children).toBeUndefined();
  });
});
