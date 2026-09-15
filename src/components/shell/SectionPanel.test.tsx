import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { screen } from '@testing-library/react';
import { usePathname } from '@/test/mocks/next-navigation';
import { SidebarProvider } from '@/components/ui/sidebar';
import { renderWithProviders } from '@/test/render';

// Track 1 owns the conversation list; the panel only has to place it.
jest.mock('@/components/chat/ConversationList', () => ({
  ConversationList: ({ notificationConvIds = [] }: { notificationConvIds?: string[] }) => (
    <div data-testid="conversation-list">{notificationConvIds.join(',')}</div>
  ),
}));

// See AppRail.test.tsx: `jest.mock` is not hoisted here, so require late.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SectionPanel } = require('./SectionPanel') as typeof import('./SectionPanel');

function renderPanel() {
  return renderWithProviders(
    <SidebarProvider>
      <SectionPanel />
    </SidebarProvider>,
  );
}

beforeEach(() => {
  (usePathname as jest.Mock).mockReturnValue('/chat');
});

describe('SectionPanel', () => {
  test('renders the chat panel on /chat', () => {
    renderPanel();

    expect(screen.getByTestId('conversation-list')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /new chat/i })).toHaveAttribute('href', '/chat');
  });

  test('renders the admin sub-nav on /admin/users', () => {
    (usePathname as jest.Mock).mockReturnValue('/admin/users');
    renderPanel();

    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('link', { name: 'Flags' })).toHaveAttribute('href', '/admin/flags');
    expect(screen.getByRole('link', { name: 'Repositories' })).toBeInTheDocument();
    expect(screen.queryByTestId('conversation-list')).not.toBeInTheDocument();
  });

  test('renders the knowledge sub-nav on a nested knowledge route', () => {
    (usePathname as jest.Mock).mockReturnValue('/knowledge/dashboard');
    renderPanel();

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('link', { name: 'Map' })).toHaveAttribute('data-active', 'false');
  });

  test('gives every sub-nav link an icon without changing its name', () => {
    (usePathname as jest.Mock).mockReturnValue('/admin/users');
    renderPanel();

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(8);
    for (const link of links) {
      expect(link.querySelector('svg')).toBeInTheDocument();
    }
    // The glyph is decorative: the label alone still names the link.
    expect(screen.getByRole('link', { name: 'Knowledge' })).toHaveAttribute(
      'href',
      '/admin/knowledge',
    );
  });

  test('renders nothing for a section with no panel', () => {
    (usePathname as jest.Mock).mockReturnValue('/settings');
    renderPanel();

    expect(document.querySelector('[data-slot="sidebar"]')).toBeNull();
  });
});
