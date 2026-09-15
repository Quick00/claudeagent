import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import AdminConversationsPanel from './AdminConversationsPanel';

interface Row {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  user: { id: string; name: string; email: string };
}

const JANE_DEPLOY: Row = {
  id: 'c1',
  title: 'Why is the deploy failing?',
  createdAt: '2026-01-01T10:00:00.000Z',
  updatedAt: '2026-01-03T10:00:00.000Z',
  messageCount: 7,
  user: { id: 'u1', name: 'Jane Doe', email: 'jane@example.com' },
};

const SAM_INVOICES: Row = {
  id: 'c2',
  title: 'Where do invoices live?',
  createdAt: '2026-01-02T10:00:00.000Z',
  updatedAt: '2026-01-02T12:00:00.000Z',
  messageCount: 2,
  user: { id: 'u2', name: 'Sam Rivera', email: 'sam@example.com' },
};

function setupFetch(rows: Row[] = [JANE_DEPLOY, SAM_INVOICES]) {
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/admin/conversations') {
      return { ok: true, status: 200, json: async () => rows } as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

/** The rendered table body rows, excluding the header row. */
function bodyRows() {
  return within(screen.getByRole('table')).getAllByRole('row').slice(1);
}

beforeEach(() => {
  setupFetch();
});

describe('AdminConversationsPanel', () => {
  test('renders a row per conversation with its owner and message count', async () => {
    renderWithProviders(<AdminConversationsPanel />);

    const row = (await screen.findByText('Why is the deploy failing?')).closest('tr')!;
    expect(within(row).getByText('Jane Doe')).toBeInTheDocument();
    expect(within(row).getByText('7')).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(2);
  });

  test('a row links to the conversation so an admin can read and reply', async () => {
    renderWithProviders(<AdminConversationsPanel />);

    expect(await screen.findByRole('link', { name: /why is the deploy failing/i })).toHaveAttribute(
      'href',
      '/chat/c1',
    );
  });

  test('searching narrows the table to matching titles', async () => {
    const { user } = renderWithProviders(<AdminConversationsPanel />);
    await screen.findByText('Why is the deploy failing?');

    await user.type(screen.getByLabelText('Search conversations'), 'invoices');

    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText('Where do invoices live?')).toBeInTheDocument();
  });

  test('searching also matches the owner rather than only the title', async () => {
    const { user } = renderWithProviders(<AdminConversationsPanel />);
    await screen.findByText('Why is the deploy failing?');

    await user.type(screen.getByLabelText('Search conversations'), 'sam');

    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText('Where do invoices live?')).toBeInTheDocument();
  });

  test('filtering by owner shows only that owner’s conversations', async () => {
    const { user } = renderWithProviders(<AdminConversationsPanel />);
    await screen.findByText('Why is the deploy failing?');

    await user.click(screen.getByRole('button', { name: /all users/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'Jane Doe' }));

    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText('Why is the deploy failing?')).toBeInTheDocument();
    expect(screen.queryByText('Where do invoices live?')).not.toBeInTheDocument();
  });

  test('says so when a filter matches nothing instead of showing an empty table', async () => {
    const { user } = renderWithProviders(<AdminConversationsPanel />);
    await screen.findByText('Why is the deploy failing?');

    await user.type(screen.getByLabelText('Search conversations'), 'nothing matches this');

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText(/no conversations match/i)).toBeInTheDocument();
  });

  test('shows an empty state when there are no conversations at all', async () => {
    setupFetch([]);
    renderWithProviders(<AdminConversationsPanel />);

    expect(await screen.findByText(/no conversations yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
