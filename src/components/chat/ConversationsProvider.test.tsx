import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { renderWithProviders } from '@/test/render';
import { mockRouter, usePathname } from '@/test/mocks/next-navigation';
import { Button } from '@/components/ui/button';
import { ConversationsProvider, useConversations } from './ConversationsProvider';

const mockFetch = jest.fn<(input: string, init?: RequestInit) => Promise<unknown>>();
global.fetch = mockFetch as unknown as typeof fetch;

const jsonOk = (data: unknown) => ({ ok: true, status: 200, json: async () => data });

type Row = { id: string; title: string; updatedAt: string };

/**
 * A server that actually forgets a deleted conversation. `remove()` drops the
 * row from the cache and then invalidates, so the refetch has to agree —
 * a mock that kept answering with the deleted row would let a broken
 * invalidation pass.
 */
function serveRows(initial: Row[]) {
  let rows = [...initial];
  mockFetch.mockImplementation(async (input: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') {
      rows = rows.filter((r) => r.id !== input.replace('/api/conversations/', ''));
      return jsonOk({});
    }
    return jsonOk(rows);
  });
  return () => rows;
}

function Harness() {
  const {
    conversations,
    loading,
    loadFailed,
    refresh,
    remove,
    rename,
    pendingConversationId,
    beginNavigation,
  } = useConversations();
  return (
    <div>
      {loading && <p>Loading conversations</p>}
      <p>{`loadFailed:${loadFailed ? 'yes' : 'no'}`}</p>
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
      <Button onClick={() => rename('a', 'Renamed')}>rename a</Button>
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
    serveRows([
      { id: 'a', title: 'First', updatedAt: '2026-01-01' },
      { id: 'b', title: 'Second', updatedAt: '2026-01-02' },
    ]);
    const { user } = renderProvider();
    await screen.findByText('Second');

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
    serveRows([{ id: 'b', title: 'Second', updatedAt: '2026-01-02' }]);
    const { user } = renderProvider();
    await screen.findByText('Second');

    await user.click(screen.getByRole('button', { name: 'delete b' }));

    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/chat'));
  });

  test('a failed delete toasts and leaves the row in place', async () => {
    serveRows([{ id: 'b', title: 'Second', updatedAt: '2026-01-02' }]);
    const { user } = renderProvider();
    await screen.findByText('Second');

    const toastError = jest.spyOn(toast, 'error').mockReturnValue('');
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => '' });
    await user.click(screen.getByRole('button', { name: 'delete b' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    toastError.mockRestore();
    expect(screen.getByText('Second')).toBeInTheDocument();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  test('exposes loadFailed when the list cannot be read', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => '' });

    renderProvider();

    expect(await screen.findByText('loadFailed:yes')).toBeInTheDocument();
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

  // Regression: the pending record used to be compared against the pathname
  // it started from, so navigating /chat -> /chat/b -> New chat put the
  // pathname back to /chat, matched the old record again, and left the
  // new-chat pane rendering ChatThreadSkeleton forever.
  test('a resolved navigation does not come back when the route returns to where it started', async () => {
    serveRows([{ id: 'b', title: 'Second', updatedAt: '2026-01-02' }]);
    const { user, rerender } = renderProvider();
    await screen.findByText('Second');

    await user.click(screen.getByRole('button', { name: 'open b' }));
    expect(screen.getByText('pending:b')).toBeInTheDocument();

    const remount = () =>
      rerender(
        <ConversationsProvider>
          <Harness />
        </ConversationsProvider>,
      );

    usePathname.mockReturnValue('/chat/b');
    remount();
    expect(screen.getByText('pending:none')).toBeInTheDocument();

    // "New chat" takes the user back to the pathname the navigation began on.
    usePathname.mockReturnValue('/chat');
    remount();

    expect(screen.getByText('pending:none')).toBeInTheDocument();
  });

  test('rename() PATCHes the conversation and shows the new title', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === 'PATCH') {
        return jsonOk({ id: 'a', title: 'Renamed', updatedAt: '2026-01-03' });
      }
      const renamed = calls.some((c) => c.init?.method === 'PATCH');
      return jsonOk([
        { id: 'a', title: renamed ? 'Renamed' : 'First', updatedAt: '2026-01-01' },
      ]);
    });
    const { user } = renderProvider();
    await screen.findByText('First');

    await user.click(screen.getByRole('button', { name: 'rename a' }));

    expect(await screen.findByText('Renamed')).toBeInTheDocument();
    const patch = calls.find((c) => c.init?.method === 'PATCH');
    expect(patch?.url).toBe('/api/conversations/a');
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ title: 'Renamed' });
    // Invalidating the whole conversations area is what makes the open
    // thread's header catch up, so the list must refetch afterwards.
    await waitFor(() =>
      expect(calls.filter((c) => c.url === '/api/conversations' && !c.init?.method).length)
        .toBeGreaterThan(1),
    );
  });

  test('rename() surfaces a server rejection instead of failing silently', async () => {
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return { ok: false, status: 400, text: async () => JSON.stringify({ error: 'bad' }) };
      }
      return jsonOk([{ id: 'a', title: 'First', updatedAt: '2026-01-01' }]);
    });
    const { user } = renderProvider();
    await screen.findByText('First');

    await user.click(screen.getByRole('button', { name: 'rename a' }));

    // The row keeps its old title rather than optimistically lying.
    await waitFor(() => expect(screen.getByText('First')).toBeInTheDocument());
    expect(screen.queryByText('Renamed')).not.toBeInTheDocument();
  });
});
