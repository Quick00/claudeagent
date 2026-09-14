import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { mockRouter, usePathname } from '@/test/mocks/next-navigation';
import { Button } from '@/components/ui/button';
import { ConversationsProvider, useConversations } from './ConversationsProvider';

const mockFetch = jest.fn<(input: string, init?: RequestInit) => Promise<unknown>>();
global.fetch = mockFetch as unknown as typeof fetch;

const jsonOk = (data: unknown) => ({ ok: true, status: 200, json: async () => data });

function Harness() {
  const { conversations, loading, refresh, remove, setTitle, pendingConversationId, beginNavigation } =
    useConversations();
  return (
    <div>
      {loading && <p>Loading conversations</p>}
      <p>{`pending:${pendingConversationId ?? 'none'}`}</p>
      <Button onClick={() => beginNavigation('b')}>open b</Button>
      <ul>
        {conversations.map((c) => (
          <li key={c.id}>{c.title}</li>
        ))}
      </ul>
      <Button onClick={() => refresh()}>refresh</Button>
      {conversations.map((c) => (
        <Button key={`del-${c.id}`} onClick={() => remove(c.id)}>
          {`delete ${c.id}`}
        </Button>
      ))}
      <Button onClick={() => setTitle('a', 'Renamed')}>rename a</Button>
    </div>
  );
}

function renderProvider() {
  return renderWithProviders(
    <ConversationsProvider>
      <Harness />
    </ConversationsProvider>,
  );
}

describe('ConversationsProvider', () => {
  beforeEach(() => {
    usePathname.mockReturnValue('/chat');
    mockFetch.mockReset();
  });

  test('fetches the list on mount and exposes the rows', async () => {
    mockFetch.mockResolvedValue(jsonOk([{ id: 'a', title: 'First', updatedAt: '2026-01-01' }]));

    renderProvider();

    expect(await screen.findByText('First')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith('/api/conversations', expect.anything());
    await waitFor(() => expect(screen.queryByText('Loading conversations')).not.toBeInTheDocument());
  });

  test('refresh() refetches and exposes the new rows', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk([{ id: 'a', title: 'First', updatedAt: '2026-01-01' }]));
    const { user } = renderProvider();
    await screen.findByText('First');

    mockFetch.mockResolvedValueOnce(
      jsonOk([
        { id: 'a', title: 'First', updatedAt: '2026-01-01' },
        { id: 'b', title: 'Second', updatedAt: '2026-01-02' },
      ]),
    );
    await user.click(screen.getByRole('button', { name: 'refresh' }));

    expect(await screen.findByText('Second')).toBeInTheDocument();
  });

  test('remove() DELETEs the conversation and drops the row', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonOk([
        { id: 'a', title: 'First', updatedAt: '2026-01-01' },
        { id: 'b', title: 'Second', updatedAt: '2026-01-02' },
      ]),
    );
    const { user } = renderProvider();
    await screen.findByText('Second');

    mockFetch.mockResolvedValueOnce(jsonOk({}));
    await user.click(screen.getByRole('button', { name: 'delete b' }));

    await waitFor(() => expect(screen.queryByText('Second')).not.toBeInTheDocument());
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/conversations/b',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  test('removing the conversation that is currently open navigates to /chat', async () => {
    usePathname.mockReturnValue('/chat/b');
    mockFetch.mockResolvedValueOnce(jsonOk([{ id: 'b', title: 'Second', updatedAt: '2026-01-02' }]));
    const { user } = renderProvider();
    await screen.findByText('Second');

    mockFetch.mockResolvedValueOnce(jsonOk({}));
    await user.click(screen.getByRole('button', { name: 'delete b' }));

    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/chat'));
  });

  test('beginNavigation() marks a conversation pending until the route changes', async () => {
    mockFetch.mockResolvedValue(jsonOk([{ id: 'b', title: 'Second', updatedAt: '2026-01-02' }]));
    const { user, rerender } = renderProvider();
    await screen.findByText('Second');
    expect(screen.getByText('pending:none')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'open b' }));
    expect(screen.getByText('pending:b')).toBeInTheDocument();

    // The router commits the navigation: the pathname the pending state was
    // recorded against is gone, so it must read back as resolved.
    usePathname.mockReturnValue('/chat/b');
    rerender(
      <ConversationsProvider>
        <Harness />
      </ConversationsProvider>,
    );

    expect(screen.getByText('pending:none')).toBeInTheDocument();
  });

  test('setTitle() renames a row in place without refetching', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk([{ id: 'a', title: 'First', updatedAt: '2026-01-01' }]));
    const { user } = renderProvider();
    await screen.findByText('First');

    await user.click(screen.getByRole('button', { name: 'rename a' }));

    expect(await screen.findByText('Renamed')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
