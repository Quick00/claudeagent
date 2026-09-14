import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { screen } from '@testing-library/react';
import { usePathname } from '@/test/mocks/next-navigation';
import { SidebarProvider } from '@/components/ui/sidebar';
import { renderWithProviders } from '@/test/render';
import type { ShellUser } from './AppShell';
import { NotificationsProvider } from './NotificationsProvider';

// The user menu pulls in Track 4's TipTap-backed feedback dialog, which has
// nothing to do with the rail.
jest.mock('@/components/FeedbackModal', () => ({
  __esModule: true,
  default: () => null,
}));

// `jest.mock` is not hoisted above the imports here (the SWC transform leaves
// it in place when `jest` comes from `@jest/globals`), so the module under
// test is required after the mocks are registered.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppRail } = require('./AppRail') as typeof import('./AppRail');

function user(role: string): ShellUser {
  return { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', image: null, role };
}

function renderRail(role: string) {
  return renderWithProviders(
    <SidebarProvider>
      <AppRail user={user(role)} />
    </SidebarProvider>,
  );
}

beforeEach(() => {
  (usePathname as jest.Mock).mockReturnValue('/chat');
});

describe('AppRail', () => {
  test('hides the admin section from a plain user', () => {
    renderRail('user');

    expect(screen.getByRole('link', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Knowledge' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
  });

  test('shows the admin section for an admin', () => {
    renderRail('admin');

    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin/users');
  });

  test('marks the section that owns the current pathname as active', () => {
    (usePathname as jest.Mock).mockReturnValue('/admin/users');
    renderRail('admin');

    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('link', { name: 'Chat' })).toHaveAttribute('data-active', 'false');
  });

  test('anchors the account menu at the foot of the rail', () => {
    renderRail('user');

    const trigger = screen.getByRole('button', { name: /Ada Lovelace/ });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger.closest('[data-slot="sidebar-footer"]')).not.toBeNull();
  });

  test('badges the admin item with the combined pending count', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.startsWith('/api/flags/admin-notifications')
        ? { count: 2 }
        : url.startsWith('/api/admin/feedback')
          ? [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }]
          : { conversationIds: [] };
      return { ok: true, json: async () => body } as Response;
    }) as unknown as typeof fetch;

    renderWithProviders(
      <SidebarProvider>
        <NotificationsProvider isAdmin>
          <AppRail user={user('admin')} />
        </NotificationsProvider>
      </SidebarProvider>,
    );

    expect(await screen.findByText('5')).toBeInTheDocument();
  });

  test('pins the bottom-placed sections below the top ones', () => {
    renderRail('admin');

    const labels = screen
      .getAllByRole('link')
      .map((link) => link.textContent?.trim())
      .filter(Boolean);
    expect(labels).toEqual(['Chat', 'Knowledge', 'Admin', 'Settings']);
  });
});
