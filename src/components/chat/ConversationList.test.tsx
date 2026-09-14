import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
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
    if (init?.method === 'PATCH') {
      const id = input.replace('/api/conversations/', '');
      const { title } = JSON.parse(String(init.body));
      rows = rows.map((r) => (r.id === id ? { ...r, title } : r));
      return jsonOk(rows.find((r) => r.id === id));
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

/**
 * An instant that is late morning in Amsterdam (the timezone the app buckets
 * in), `n` calendar days ago. Stepping whole days from a fixed UTC hour keeps
 * the calendar day right across a DST change, and anchoring to Amsterdam
 * rather than the test machine's zone keeps the fixtures stable in CI.
 */
function daysAgo(n: number): string {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .split('-')
    .map(Number);
  return new Date(Date.UTC(y, m - 1, d, 10) - n * 86_400_000).toISOString();
}

const DATED_ROWS: Row[] = [
  { id: 't', title: 'Asked this morning', updatedAt: daysAgo(0) },
  { id: 'y', title: 'Asked yesterday', updatedAt: daysAgo(1) },
  { id: 'w', title: 'Asked midweek', updatedAt: daysAgo(3) },
  { id: 'm', title: 'Asked a few weeks back', updatedAt: daysAgo(20) },
];

/** The group box whose heading is `label`. */
function group(label: string) {
  const heading = screen.getByText(label);
  const box = heading.closest('[data-slot="sidebar-group-content"]');
  if (!box) throw new Error(`no group box around "${label}"`);
  return within(box as HTMLElement);
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

  test('groups conversations by recency and files each row under its heading', async () => {
    serveRows(DATED_ROWS);
    renderList();
    await screen.findByRole('link', { name: /Asked this morning/ });

    expect(group('Today').getByRole('link', { name: /Asked this morning/ })).toBeInTheDocument();
    expect(group('Yesterday').getByRole('link', { name: /Asked yesterday/ })).toBeInTheDocument();
    expect(
      group('Previous 7 days').getByRole('link', { name: /Asked midweek/ }),
    ).toBeInTheDocument();
    expect(
      group('Previous 30 days').getByRole('link', { name: /Asked a few weeks back/ }),
    ).toBeInTheDocument();
  });

  test('shows no heading for a bucket that caught nothing', async () => {
    serveRows([DATED_ROWS[0]]);
    renderList();
    await screen.findByRole('link', { name: /Asked this morning/ });

    expect(screen.getByText('Today')).toBeInTheDocument();
    for (const empty of ['Yesterday', 'Previous 7 days', 'Previous 30 days', 'Older']) {
      expect(screen.queryByText(empty)).not.toBeInTheDocument();
    }
  });

  test('keeps the groups while filtering, and drops headings that no longer match', async () => {
    serveRows(DATED_ROWS);
    const { user } = renderList();
    await screen.findByRole('link', { name: /Asked this morning/ });

    await user.type(screen.getByRole('searchbox', { name: /filter conversations/i }), 'asked a');

    // The one surviving match keeps its date heading — with titles this
    // similar it is often the only thing telling two matches apart.
    expect(
      group('Previous 30 days').getByRole('link', { name: /Asked a few weeks back/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Today')).not.toBeInTheDocument();
    expect(screen.queryByText('Yesterday')).not.toBeInTheDocument();
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

  /** Opens a row's ⋯ menu and returns its items. */
  async function openRowMenu(user: UserEvent, rowTitle: RegExp) {
    await user.click(screen.getByRole('button', { name: new RegExp(`Actions for .*${rowTitle.source}`) }));
    return screen.findByRole('menu');
  }

  test('the actions menu opens without navigating the row', async () => {
    const { user } = renderList();
    await screen.findByRole('link', { name: /Badge types/ });
    const before = window.location.pathname;

    const menu = await openRowMenu(user, /Badge types/);

    expect(within(menu).getByRole('menuitem', { name: /rename/i })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /delete/i })).toBeInTheDocument();
    expect(window.location.pathname).toBe(before);
  });

  test('renames a conversation inline and PATCHes the new title', async () => {
    const { user } = renderList();
    await screen.findByRole('link', { name: /Badge types/ });

    const menu = await openRowMenu(user, /Badge types/);
    await user.click(within(menu).getByRole('menuitem', { name: /rename/i }));

    const input = await screen.findByRole('textbox', { name: /rename badge types/i });
    // While editing there is no anchor in the row at all, so nothing can
    // navigate away mid-edit.
    expect(screen.queryByRole('link', { name: /Badge types/ })).not.toBeInTheDocument();

    await user.clear(input);
    await user.type(input, 'Badge types explained{Enter}');

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/conversations/b',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    const patch = mockFetch.mock.calls.find(([, i]) => (i as RequestInit)?.method === 'PATCH')!;
    expect(JSON.parse(String((patch[1] as RequestInit).body))).toEqual({
      title: 'Badge types explained',
    });
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Badge types explained/ })).toBeInTheDocument(),
    );
  });

  test('Escape abandons a rename without saving it', async () => {
    const { user } = renderList();
    await screen.findByRole('link', { name: /Badge types/ });

    const menu = await openRowMenu(user, /Badge types/);
    await user.click(within(menu).getByRole('menuitem', { name: /rename/i }));
    const input = await screen.findByRole('textbox', { name: /rename badge types/i });
    await user.clear(input);
    await user.type(input, 'Something else{Escape}');

    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Badge types/ })).toBeInTheDocument(),
    );
    expect(mockFetch).not.toHaveBeenCalledWith(
      '/api/conversations/b',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  test('a blur while the rename is still saving does not send it twice', async () => {
    // Hold the PATCH open so the input can blur mid-flight, which is exactly
    // when a second save would slip through.
    let releasePatch!: () => void;
    const patched = new Promise<void>((resolve) => {
      releasePatch = resolve;
    });
    let rows = [...ROWS];
    mockFetch.mockImplementation(async (input: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        await patched;
        const { title } = JSON.parse(String(init.body));
        rows = rows.map((r) => (r.id === 'b' ? { ...r, title } : r));
        return jsonOk(rows.find((r) => r.id === 'b'));
      }
      return jsonOk(rows);
    });

    const { user } = renderList();
    await screen.findByRole('link', { name: /Badge types/ });
    const menu = await openRowMenu(user, /Badge types/);
    await user.click(within(menu).getByRole('menuitem', { name: /rename/i }));
    const input = await screen.findByRole('textbox', { name: /rename badge types/i });

    await user.clear(input);
    await user.type(input, 'Renamed once{Enter}');
    // Submitting disables the input while the PATCH is open, and a browser
    // blurs an element it has just disabled. jsdom does not, so fire the
    // focusout React would actually receive.
    fireEvent.focusOut(input);
    releasePatch();

    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Renamed once/ })).toBeInTheDocument(),
    );
    expect(
      mockFetch.mock.calls.filter(([, i]) => (i as RequestInit)?.method === 'PATCH'),
    ).toHaveLength(1);
  });

  test('deletes only after the confirmation is accepted', async () => {
    const { user } = renderList();
    await screen.findByRole('link', { name: /Badge types/ });

    const menu = await openRowMenu(user, /Badge types/);
    await user.click(within(menu).getByRole('menuitem', { name: /delete/i }));

    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }));

    expect(mockFetch).not.toHaveBeenCalledWith(
      '/api/conversations/b',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(screen.getByRole('link', { name: /Badge types/ })).toBeInTheDocument();

    const reopenedMenu = await openRowMenu(user, /Badge types/);
    await user.click(within(reopenedMenu).getByRole('menuitem', { name: /delete/i }));
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
