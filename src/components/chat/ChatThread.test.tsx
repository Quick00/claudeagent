import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { usePathname } from '@/test/mocks/next-navigation';
import { setMockSession } from '@/test/mocks/next-auth-react';
import { ConversationsProvider } from './ConversationsProvider';
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
  mockFetch.mockImplementation(async (input: string) => {
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

  test('warns an admin that they are posting in someone else’s conversation', async () => {
    routeFetch({
      '/api/conversations/': () =>
        jsonOk({ ...CONVERSATION, isOwner: false, isAdmin: true }),
    });
    renderThread('conv-1');

    expect(await screen.findByText(/admin view/i)).toBeInTheDocument();
  });
});
