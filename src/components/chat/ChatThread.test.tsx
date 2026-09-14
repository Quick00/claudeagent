import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { TooltipProvider } from '@/components/ui/tooltip';
import { mockRouter, usePathname } from '@/test/mocks/next-navigation';
import { setMockSession } from '@/test/mocks/next-auth-react';
import { StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ConversationsProvider, useConversations } from './ConversationsProvider';
import { ChatThread } from './ChatThread';

const mockFetch = jest.fn<(input: string, init?: RequestInit) => Promise<unknown>>();
global.fetch = mockFetch as unknown as typeof fetch;

const jsonOk = (data: unknown) => ({ ok: true, status: 200, json: async () => data });

/** A fake SSE body: one `data:` frame per event, read chunk by chunk. */
function sseResponse(events: unknown[]) {
  const encoder = new TextEncoder();
  const chunks = events.map((e) => encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { done: false, value: chunks[i++] }
            : { done: true, value: undefined },
        cancel: async () => {},
      }),
    },
  };
}

/**
 * The same bytes as `sseResponse`, but sliced into fixed-size chunks that cut
 * frames in half — what a real network does, and what the reader's cross-chunk
 * buffer exists to survive.
 */
function sseResponseChunked(events: unknown[], chunkSize: number) {
  const encoder = new TextEncoder();
  const all = encoder.encode(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''));
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < all.length; i += chunkSize) chunks.push(all.slice(i, i + chunkSize));
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { done: false, value: chunks[i++] }
            : { done: true, value: undefined },
        cancel: async () => {},
      }),
    },
  };
}

const CONVERSATION = {
  id: 'conv-1',
  isOwner: true,
  isAdmin: false,
  ownerHasClaudeToken: true,
  claudeSessionId: 'sess-1',
  user: { name: 'Damian' },
  flags: [],
  messages: [
    { id: 'm1', role: 'user', content: 'How does login work?', createdAt: '2026-01-01T10:00:00Z' },
    { id: 'm2', role: 'assistant', content: 'It uses OAuth.', createdAt: '2026-01-01T10:00:05Z' },
  ],
};

/** Routes the component's fetches; `overrides` wins per URL prefix. */
function routeFetch(overrides: Record<string, () => unknown> = {}) {
  mockFetch.mockImplementation(async (input: string, init?: RequestInit) => {
    // Faithful to the real `fetch`: an already-aborted signal rejects rather
    // than quietly succeeding. Without this the mock hides abort bugs.
    if (init?.signal?.aborted) {
      const err = new Error('The operation was aborted.');
      err.name = 'AbortError';
      throw err;
    }
    for (const [prefix, handler] of Object.entries(overrides)) {
      if (input.startsWith(prefix)) return handler();
    }
    if (input.startsWith('/api/auth/claude/status')) return jsonOk({ linked: true });
    if (input.startsWith('/api/conversations/')) return jsonOk(CONVERSATION);
    if (input.startsWith('/api/conversations')) return jsonOk([]);
    return jsonOk({});
  });
}

function renderThread(initialConversationId: string | null) {
  return renderWithProviders(
    <ConversationsProvider>
      <ChatThread initialConversationId={initialConversationId} />
    </ConversationsProvider>,
  );
}

describe('ChatThread', () => {
  beforeEach(() => {
    usePathname.mockReturnValue('/chat');
    setMockSession({
      user: { id: 'u1', name: 'Damian', role: 'user', status: 'APPROVED' },
      expires: '2099-01-01',
    });
    mockFetch.mockReset();
    routeFetch();
  });

  test('renders the messages of an existing conversation', async () => {
    renderThread('conv-1');

    expect(await screen.findByText('How does login work?')).toBeInTheDocument();
    expect(screen.getByText('It uses OAuth.')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith('/api/conversations/conv-1', expect.anything());
  });

  test('sending posts the message to /api/chat and streams the answer back', async () => {
    routeFetch({
      '/api/chat': () => sseResponse([{ type: 'text', content: 'Because it does.' }]),
    });
    const { user } = renderThread('conv-1');
    await screen.findByText('It uses OAuth.');

    await user.type(screen.getByRole('textbox', { name: /message/i }), 'Why?');
    await user.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/chat',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const call = mockFetch.mock.calls.find(([url]) => url === '/api/chat')!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toMatchObject({
      conversationId: 'conv-1',
      message: 'Why?',
    });
    expect(await screen.findByText('Because it does.')).toBeInTheDocument();
  });

  test('a new conversation replaces the URL with /chat/<id> and keeps the optimistic bubble', async () => {
    routeFetch({
      '/api/chat': () =>
        sseResponse([
          { type: 'conversation_created', conversationId: 'conv-new', title: 'First question' },
          { type: 'text', content: 'Here is the answer.' },
          { type: 'done' },
        ]),
      // What the server really holds once the answer has landed. The `done`
      // frame invalidates the thread, so the cache — not the hook — is what
      // the UI ends up rendering; a mock that answered with someone else's
      // conversation would be testing a fiction.
      '/api/conversations/conv-new': () =>
        jsonOk({
          ...CONVERSATION,
          id: 'conv-new',
          messages: [
            { id: 'm1', role: 'user', content: 'First question', createdAt: '2026-01-01T10:00:00Z' },
            {
              id: 'm2',
              role: 'assistant',
              content: 'Here is the answer.',
              createdAt: '2026-01-01T10:00:05Z',
            },
          ],
        }),
    });
    const { user } = renderThread(null);

    await user.type(screen.getByRole('textbox', { name: /message/i }), 'First question');
    await user.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(window.location.pathname).toBe('/chat/conv-new'));
    // `history.replaceState`, never `router.push`: a push remounts the thread
    // and throws away the optimistic bubble mid-answer.
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(screen.getByText('First question')).toBeInTheDocument();
    expect(await screen.findByText('Here is the answer.')).toBeInTheDocument();
    // Still there after the post-stream invalidation has been served.
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith('/api/conversations/conv-new', expect.anything()),
    );
    expect(screen.getByText('First question')).toBeInTheDocument();
    expect(screen.getByText('Here is the answer.')).toBeInTheDocument();
  });

  test('offers to link a Claude account when the owner has none', async () => {
    routeFetch({ '/api/auth/claude/status': () => jsonOk({ linked: false }) });
    renderThread(null);

    expect(await screen.findByRole('button', { name: /link claude account/i })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /message/i })).not.toBeInTheDocument();
  });

  // Regression: StrictMode re-runs effects without re-rendering. A shared
  // AbortController that the first cleanup aborted must not be reused, or
  // every fetch rejects instantly, `initialLoading` clears with no messages,
  // and the new-chat empty state flashes on a conversation that has messages.
  // Rendered with a bare `render` rather than `renderWithProviders`: the
  // next-themes provider in that helper defers its subtree past the initial
  // mount, and React only simulates the extra StrictMode mount there — the
  // double-invocation this test exists to exercise never happens under it.
  test('loads the thread under StrictMode double-invoked effects', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
    });
    render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <TooltipProvider>
            <ConversationsProvider>
              <ChatThread initialConversationId="conv-1" />
            </ConversationsProvider>
          </TooltipProvider>
        </QueryClientProvider>
      </StrictMode>,
    );

    expect(await screen.findByText('It uses OAuth.')).toBeInTheDocument();
    expect(screen.queryByText(/Ask a question about how the product works/)).not.toBeInTheDocument();
  });

  test('swaps to the skeleton the moment another conversation is picked', async () => {
    function OpenOther() {
      const { beginNavigation } = useConversations();
      return <Button onClick={() => beginNavigation('conv-2')}>open other</Button>;
    }
    const { user } = renderWithProviders(
      <ConversationsProvider>
        <OpenOther />
        <ChatThread initialConversationId={null} />
      </ConversationsProvider>,
    );
    expect(await screen.findByText(/Ask a question about how the product works/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'open other' }));

    // The outgoing new-chat empty state must be gone immediately, replaced by
    // the same skeleton the destination's loading.tsx renders.
    expect(screen.queryByText(/Ask a question about how the product works/)).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  });

  // The point of adopting Query: a thread read inside `staleTime` comes back
  // from the cache, so there is no skeleton and no second request at all.
  test('re-opening a conversation inside staleTime renders from cache with no skeleton', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30_000, gcTime: 5 * 60_000 } },
    });
    const tree = (
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <ConversationsProvider>
            <ChatThread initialConversationId="conv-1" />
          </ConversationsProvider>
        </TooltipProvider>
      </QueryClientProvider>
    );

    const first = render(tree);
    await screen.findByText('It uses OAuth.');
    const requestsAfterFirstVisit = mockFetch.mock.calls.filter(
      ([url]) => url === '/api/conversations/conv-1',
    ).length;
    first.unmount();

    render(tree);

    // Synchronous: no `findBy`, no waiting, and nothing skeleton-shaped.
    expect(screen.getByText('It uses OAuth.')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="skeleton"]')).toBeNull();
    expect(
      mockFetch.mock.calls.filter(([url]) => url === '/api/conversations/conv-1').length,
    ).toBe(requestsAfterFirstVisit);
  });

  // A thread whose last message is the user's is waiting on an answer being
  // produced somewhere else, so it polls and shows the thinking indicator...
  test('waits for an answer that is still being generated elsewhere', async () => {
    routeFetch({
      '/api/conversations/': () =>
        jsonOk({
          ...CONVERSATION,
          messages: [
            { id: 'm1', role: 'user', content: 'Still running?', createdAt: new Date().toISOString() },
          ],
        }),
    });
    renderThread('conv-1');

    await screen.findByText('Still running?');
    expect(screen.getByText(/thinking/i)).toBeInTheDocument();
  });

  // ...but only for a bounded window. A run that died hours ago must not leave
  // the composer disabled and a 500ms poll running for the rest of the session.
  test('does not wait forever on a run that never finished', async () => {
    routeFetch({
      '/api/conversations/': () =>
        jsonOk({
          ...CONVERSATION,
          messages: [
            { id: 'm1', role: 'user', content: 'Abandoned run', createdAt: '2020-01-01T00:00:00Z' },
          ],
        }),
    });
    renderThread('conv-1');

    await screen.findByText('Abandoned run');
    expect(screen.queryByText(/thinking/i)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /message/i })).toBeEnabled();
  });

  test('warns an admin that they are posting in someone else’s conversation', async () => {
    routeFetch({
      '/api/conversations/': () =>
        jsonOk({ ...CONVERSATION, isOwner: false, isAdmin: true }),
    });
    renderThread('conv-1');

    expect(await screen.findByText(/admin view/i)).toBeInTheDocument();
  });

  // ─────────────────── One bubble per text segment ───────────────────
  // A tool call mid-answer ends the current bubble. Without this the two
  // stretches of text run together — "…verify the existing knowledge.Good,
  // this confirms…" — which is what `text_break` exists to prevent.

  /** The assistant bubbles on screen, in DOM order. Only the assistant branch
   *  of `MessageBubble` renders `MarkdownContent`, so this counts exactly. */
  const assistantBubbles = () =>
    screen.getAllByTestId('markdown').map((el) => el.textContent);

  test('a tool call mid-answer starts a new bubble instead of appending', async () => {
    routeFetch({
      '/api/chat': () =>
        sseResponse([
          { type: 'text', content: 'Found it. Let me read the relevant files.' },
          { type: 'text_break' },
          { type: 'tool_use', tool: 'Read' },
          { type: 'text', content: 'Good, this confirms the label text.' },
        ]),
    });
    const { user } = renderThread('conv-1');
    await screen.findByText('It uses OAuth.');

    await user.type(screen.getByRole('textbox', { name: /message/i }), 'How?');
    await user.click(screen.getByRole('button', { name: /^send$/i }));

    await screen.findByText('Good, this confirms the label text.');
    expect(assistantBubbles()).toEqual([
      'It uses OAuth.',
      'Found it. Let me read the relevant files.',
      'Good, this confirms the label text.',
    ]);
    // The regression itself: never the two halves in one bubble.
    expect(
      screen.queryByText(/relevant files\.Good, this confirms/),
    ).not.toBeInTheDocument();
  });

  test('a repeated text_break does not open an empty bubble', async () => {
    routeFetch({
      '/api/chat': () =>
        sseResponse([
          { type: 'text', content: 'First.' },
          { type: 'text_break' },
          { type: 'text_break' },
          { type: 'text', content: 'Second.' },
        ]),
    });
    const { user } = renderThread('conv-1');
    await screen.findByText('It uses OAuth.');

    await user.type(screen.getByRole('textbox', { name: /message/i }), 'How?');
    await user.click(screen.getByRole('button', { name: /^send$/i }));

    await screen.findByText('Second.');
    expect(assistantBubbles()).toEqual(['It uses OAuth.', 'First.', 'Second.']);
  });

  test('a text_break before any text does not open a leading empty bubble', async () => {
    routeFetch({
      '/api/chat': () =>
        sseResponse([
          { type: 'text_break' },
          { type: 'tool_use', tool: 'Grep' },
          { type: 'text', content: 'Only bubble.' },
        ]),
    });
    const { user } = renderThread('conv-1');
    await screen.findByText('It uses OAuth.');

    await user.type(screen.getByRole('textbox', { name: /message/i }), 'How?');
    await user.click(screen.getByRole('button', { name: /^send$/i }));

    await screen.findByText('Only bubble.');
    expect(assistantBubbles()).toEqual(['It uses OAuth.', 'Only bubble.']);
  });

  // The label is transient by design: it marks work in progress under the
  // finished bubble, and leaves no trace in the thread once text resumes.
  test('the tool label sits under the finished bubble and clears on the next delta', async () => {
    routeFetch({
      '/api/chat': () =>
        sseResponse([
          { type: 'text', content: 'Looking into it.' },
          { type: 'text_break' },
          { type: 'tool_use', tool: 'Read' },
        ]),
    });
    const { user } = renderThread('conv-1');
    await screen.findByText('It uses OAuth.');

    await user.type(screen.getByRole('textbox', { name: /message/i }), 'How?');
    await user.click(screen.getByRole('button', { name: /^send$/i }));

    expect(await screen.findByText('Reading files...')).toBeInTheDocument();
    expect(screen.getByText('Looking into it.')).toBeInTheDocument();
  });

  // Live and reloaded must agree: the server writes one row per segment, and
  // the post-`done` refetch must replace N bubbles with the same N, not merge.
  test('the split survives the refetch that follows done', async () => {
    routeFetch({
      '/api/chat': () =>
        sseResponse([
          { type: 'text', content: 'Found it.' },
          { type: 'text_break' },
          { type: 'tool_use', tool: 'Read' },
          { type: 'text', content: 'Confirmed.' },
          { type: 'done', conversationId: 'conv-1' },
        ]),
      // What the server holds afterwards: two assistant rows, a millisecond
      // apart, exactly as `onClose` writes them.
      '/api/conversations/conv-1': () =>
        jsonOk({
          ...CONVERSATION,
          messages: [
            { id: 'm1', role: 'user', content: 'How?', createdAt: '2026-01-01T10:00:00.000Z' },
            { id: 'm2', role: 'assistant', content: 'Found it.', createdAt: '2026-01-01T10:00:05.000Z' },
            { id: 'm3', role: 'assistant', content: 'Confirmed.', createdAt: '2026-01-01T10:00:05.001Z' },
          ],
        }),
    });
    const { user } = renderThread('conv-1');
    await screen.findByText('How?');

    await user.type(screen.getByRole('textbox', { name: /message/i }), 'How?');
    await user.click(screen.getByRole('button', { name: /^send$/i }));

    await screen.findByText('Confirmed.');
    await waitFor(() => expect(assistantBubbles()).toEqual(['Found it.', 'Confirmed.']));
  });

  // Regression: the reader decodes without `{ stream: true }` and without a
  // buffer, so a frame cut in half by a chunk boundary fails to parse and is
  // dropped. Losing a `text_break` silently merges two bubbles that the reload
  // then shows apart — the exact disagreement this feature removes.
  test('reassembles frames split across chunk boundaries', async () => {
    routeFetch({
      '/api/chat': () =>
        sseResponseChunked(
          [
            { type: 'text', content: 'Found it.' },
            { type: 'text_break' },
            { type: 'tool_use', tool: 'Read' },
            { type: 'text', content: 'Confirmed.' },
          ],
          7,
        ),
    });
    const { user } = renderThread('conv-1');
    await screen.findByText('It uses OAuth.');

    await user.type(screen.getByRole('textbox', { name: /message/i }), 'How?');
    await user.click(screen.getByRole('button', { name: /^send$/i }));

    await screen.findByText('Confirmed.');
    expect(assistantBubbles()).toEqual(['It uses OAuth.', 'Found it.', 'Confirmed.']);
  });
});
