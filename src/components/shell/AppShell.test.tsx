import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, screen } from '@testing-library/react';
import { usePathname } from '@/test/mocks/next-navigation';
import { renderWithProviders } from '@/test/render';

const isMobile = jest.fn(() => false);

jest.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => isMobile() }));
jest.mock('@/components/FeedbackModal', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/chat/ConversationsProvider', () => ({
  ConversationsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('@/components/chat/ConversationList', () => ({
  // Stands in for Track 1's rows: the only part the shell cares about is that
  // picking one calls `onNavigate`. A button keeps the lint rule about raw
  // `<a>` page links out of a test that is not about navigation.
  ConversationList: ({ onNavigate }: { onNavigate?: () => void }) => (
    <button type="button" data-testid="conversation-list" onClick={onNavigate}>
      a conversation
    </button>
  ),
}));

// See AppRail.test.tsx: `jest.mock` is not hoisted here, so require late —
// the sidebar primitive included, since its provider is what reads
// `useIsMobile` and decides between the desktop columns and the sheet.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppShell } = require('./AppShell') as typeof import('./AppShell');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SidebarProvider } = require('@/components/ui/sidebar') as typeof import('@/components/ui/sidebar');

const user = {
  id: 'u1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  image: null,
  role: 'admin',
};

async function renderShell() {
  const result = renderWithProviders(
    <SidebarProvider>
      <AppShell user={user}>
        <p>thread body</p>
      </AppShell>
    </SidebarProvider>,
  );
  // Let the notification poller's first round settle inside act().
  await act(async () => {});
  return result;
}

beforeEach(() => {
  isMobile.mockReturnValue(false);
  (usePathname as jest.Mock).mockReturnValue('/chat');
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) }) as Response) as unknown as typeof fetch;
});

describe('AppShell', () => {
  test('renders the rail, the section panel and the page on desktop', async () => {
    await renderShell();

    expect(screen.getByRole('link', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.getByTestId('conversation-list')).toBeInTheDocument();
    expect(screen.getByText('thread body')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('keeps a full-width sidebar on a section that has a panel', async () => {
    await renderShell();

    const frame = document.querySelector('[data-slot="shell-frame"]');
    expect(frame).toHaveAttribute('data-panel', 'open');
    // No override: the sidebar keeps the layout's own --sidebar-width.
    expect(frame?.getAttribute('style') ?? '').not.toContain('--sidebar-width');
    expect(screen.getByTestId('conversation-list')).toBeInTheDocument();
  });

  test('narrows the sidebar to the rail on a section with no panel', async () => {
    (usePathname as jest.Mock).mockReturnValue('/settings');
    await renderShell();

    const frame = document.querySelector('[data-slot="shell-frame"]');
    expect(frame).toHaveAttribute('data-panel', 'none');
    expect(frame?.getAttribute('style')).toContain(
      '--sidebar-width: calc(var(--sidebar-width-icon) + 1rem + 1px)',
    );
    // Nothing renders in the column, which is why it must not reserve space.
    expect(screen.queryByTestId('conversation-list')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });

  test('never lets the shell exceed the viewport height', async () => {
    await renderShell();

    const inset = document.querySelector('[data-slot="sidebar-inset"]');
    expect(inset?.className).toContain('h-dvh');
    expect(document.body.innerHTML).not.toContain('h-screen');
  });

  test('collapses to a trigger and an off-canvas sheet on mobile', async () => {
    isMobile.mockReturnValue(true);
    const { user: userEvent } = await renderShell();

    // The rail is gone: the only way into the sections is the trigger.
    expect(screen.queryByRole('link', { name: 'Chat' })).not.toBeInTheDocument();
    expect(screen.getByText('thread body')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /toggle sidebar/i }));

    const sheet = await screen.findByRole('dialog');
    expect(sheet).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.getByTestId('conversation-list')).toBeInTheDocument();
  });

  test('closes the mobile sheet when a conversation is picked', async () => {
    isMobile.mockReturnValue(true);
    const { user: userEvent } = await renderShell();

    await userEvent.click(screen.getByRole('button', { name: /toggle sidebar/i }));
    await screen.findByRole('dialog');

    await userEvent.click(screen.getByTestId('conversation-list'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('closes the mobile sheet when a section is followed', async () => {
    isMobile.mockReturnValue(true);
    (usePathname as jest.Mock).mockReturnValue('/admin/users');
    const { user: userEvent } = await renderShell();

    await userEvent.click(screen.getByRole('button', { name: /toggle sidebar/i }));
    await screen.findByRole('dialog');

    await userEvent.click(screen.getByRole('link', { name: 'Flags' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
