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

const ROWS = [
  { id: 'a', title: 'How does login work?', updatedAt: '2026-01-01' },
  { id: 'b', title: 'Badge types', updatedAt: '2026-01-02' },
];

function renderList(props: { notificationConvIds?: string[] } = {}) {
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
    mockFetch.mockResolvedValue(jsonOk(ROWS));
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
    mockFetch.mockResolvedValueOnce(jsonOk({}));
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
    mockFetch.mockResolvedValue(jsonOk([]));
    renderList();

    expect(await screen.findByText('No conversations yet')).toBeInTheDocument();
  });
});
