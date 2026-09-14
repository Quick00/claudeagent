import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { TooltipProvider } from '@/components/ui/tooltip';
import { usePathname } from '@/test/mocks/next-navigation';
import { setMockSession } from '@/test/mocks/next-auth-react';
import { StrictMode } from 'react';
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
        ]),
    });
    const { user } = renderThread(null);

    await user.type(screen.getByRole('textbox', { name: /message/i }), 'First question');
    await user.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(window.location.pathname).toBe('/chat/conv-new'));
    expect(screen.getByText('First question')).toBeInTheDocument();
    expect(await screen.findByText('Here is the answer.')).toBeInTheDocument();
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
    render(
      <StrictMode>
        <TooltipProvider>
          <ConversationsProvider>
            <ChatThread initialConversationId="conv-1" />
          </ConversationsProvider>
        </TooltipProvider>
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

  test('warns an admin that they are posting in someone else’s conversation', async () => {
    routeFetch({
      '/api/conversations/': () =>
        jsonOk({ ...CONVERSATION, isOwner: false, isAdmin: true }),
    });
    renderThread('conv-1');

    expect(await screen.findByText(/admin view/i)).toBeInTheDocument();
  });
});
