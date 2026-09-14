import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { usePathname } from '@/test/mocks/next-navigation';
import { SidebarProvider } from '@/components/ui/sidebar';
import { ConversationsProvider } from './ConversationsProvider';
import { ConversationList } from './ConversationList';

const mockFetch = jest.fn<(input: string, init?: RequestInit) => Promise<unknown>>();
global.fetch = mockFetch as unknown as typeof fetch;

const jsonOk = (data: unknown) => ({ ok: true, status: 200, json: async () => data });

type Row = { id: string; title: string; updatedAt: string };

const ROWS: Row[] = [
  { id: 'a', title: 'How does login work?', updatedAt: '2026-01-01' },
  { id: 'b', title: 'Badge types', updatedAt: '2026-01-02' },
];

/**
 * A server that actually forgets a deleted conversation. The list is Query's
 * now, so a delete invalidates and refetches; a mock that kept answering with
 * the deleted row would be asserting against a server that never deletes.
 */
function serveRows(initial: Row[] = ROWS) {
  let rows = [...initial];
  mockFetch.mockImplementation(async (input: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') {
      const id = input.replace('/api/conversations/', '');
      rows = rows.filter((r) => r.id !== id);
      return jsonOk({});
    }
    return jsonOk(rows);
  });
}

function renderList(props: { notificationConvIds?: string[]; onNavigate?: () => void } = {}) {
  return renderWithProviders(
    <SidebarProvider>
      <ConversationsProvider>
        <ConversationList {...props} />
      </ConversationsProvider>
    </SidebarProvider>,
  );
}

describe('ConversationList', () => {
  beforeEach(() => {
    usePathname.mockReturnValue('/chat');
    mockFetch.mockReset();
    serveRows();
  });

  test('renders a link per conversation pointing at /chat/<id>', async () => {
    renderList();

    const link = await screen.findByRole('link', { name: /How does login work\?/ });
    expect(link).toHaveAttribute('href', '/chat/a');
    expect(screen.getByRole('link', { name: /Badge types/ })).toHaveAttribute('href', '/chat/b');
  });

  test('marks the row matching the current pathname active', async () => {
    usePathname.mockReturnValue('/chat/b');
    renderList();

    const active = await screen.findByRole('link', { name: /Badge types/ });
    expect(active).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('link', { name: /How does login work\?/ })).toHaveAttribute(
      'data-active',
      'false',
    );
  });

  test('deletes only after the confirmation is accepted', async () => {
    const { user } = renderList();
    await screen.findByRole('link', { name: /Badge types/ });

    await user.click(screen.getByRole('button', { name: /Delete .*Badge types/ }));

    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }));

    expect(mockFetch).not.toHaveBeenCalledWith(
      '/api/conversations/b',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(screen.getByRole('link', { name: /Badge types/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Delete .*Badge types/ }));
    const reopened = await screen.findByRole('alertdialog');
    await user.click(within(reopened).getByRole('button', { name: /^delete$/i }));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/conversations/b',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /Badge types/ })).not.toBeInTheDocument(),
    );
  });

  test('calls onNavigate when a conversation is picked, so the mobile sheet can close', async () => {
    const onNavigate = jest.fn();
    const { user } = renderList({ onNavigate });
    await screen.findByRole('link', { name: /Badge types/ });

    await user.click(screen.getByRole('link', { name: /Badge types/ }));

    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  test('does not require onNavigate', async () => {
    const { user } = renderList();
    await screen.findByRole('link', { name: /Badge types/ });

    await user.click(screen.getByRole('link', { name: /Badge types/ }));

    expect(screen.getByRole('link', { name: /Badge types/ })).toBeInTheDocument();
  });

  test('shows an unread dot for ids passed in notificationConvIds', async () => {
    renderList({ notificationConvIds: ['b'] });

    await screen.findByRole('link', { name: /Badge types/ });
    expect(screen.getByRole('link', { name: /Badge types/ })).toHaveTextContent('Unread replies');
    expect(screen.getByRole('link', { name: /How does login work\?/ })).not.toHaveTextContent(
      'Unread replies',
    );
  });

  test('filters the list by the filter box', async () => {
    const { user } = renderList();
    await screen.findByRole('link', { name: /Badge types/ });

    await user.type(screen.getByRole('searchbox', { name: /filter conversations/i }), 'badge');

    expect(screen.getByRole('link', { name: /Badge types/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /How does login work\?/ })).not.toBeInTheDocument();
  });

  test('shows an empty state when there are no conversations', async () => {
    mockFetch.mockReset();
    serveRows([]);
    renderList();

    expect(await screen.findByText('No conversations yet')).toBeInTheDocument();
  });

  // Regression guard for the hydration fix. `SidebarMenuSkeleton` sizes its
  // placeholder with `Math.random()`, so the server HTML and the first client
  // render disagreed and React logged a hydration error on every cold /chat.
  // Reintroducing a random width would make these two renders differ.
  test('renders identical, non-random skeleton widths on every render', async () => {
    mockFetch.mockReset();
    // Never resolves, so the list stays in its loading state.
    mockFetch.mockImplementation(() => new Promise(() => {}));

    const widthsOf = (container: HTMLElement) =>
      Array.from(container.querySelectorAll('[data-slot="skeleton"]')).map(
        (el) => (el as HTMLElement).style.width,
      );

    const first = renderList();
    const firstWidths = widthsOf(first.container);
    first.unmount();

    const second = renderList();
    const secondWidths = widthsOf(second.container);

    // The literal set, so a width randomised once at module scope is caught
    // as well as one randomised per render.
    expect(firstWidths).toEqual(['72%', '54%', '84%', '61%', '77%']);
    expect(secondWidths).toEqual(firstWidths);
  });

  // A 500 used to be swallowed and render as "No conversations yet", which is
  // a different and much more alarming statement than "we could not reach the
  // server". `apiFetch` throws now, so the two are distinguishable.
  test('shows a failure state rather than "no conversations" when the list errors', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => '' });
    renderList();

    expect(await screen.findByText('Could not load conversations')).toBeInTheDocument();
    expect(screen.queryByText('No conversations yet')).not.toBeInTheDocument();
  });
});
