import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { setMockSession } from '@/test/mocks/next-auth-react';
import AdminUsersPanel from './AdminUsersPanel';

const USER: {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  claudeLinked: boolean;
  createdAt: string;
} = {
  id: 'u1',
  name: 'Jane Doe',
  email: 'jane@example.com',
  role: 'user',
  status: 'PENDING',
  claudeLinked: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

/**
 * A stateful mock: PATCH/DELETE mutate the underlying list, so a refetch
 * triggered by query invalidation reflects the change — the same way the
 * real API would. A mock that always answered with the original snapshot
 * would pass the fetch assertions below while hiding a broken invalidation.
 */
function setupFetch(users = [USER]) {
  let current = users.map((u) => ({ ...u }));
  const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/admin/users') {
      if (!init || init.method === undefined) {
        return { ok: true, status: 200, json: async () => current } as Response;
      }
      if (init.method === 'PATCH') {
        const { userId, role, status } = JSON.parse(String(init.body));
        current = current.map((u) =>
          u.id === userId
            ? { ...u, ...(role !== undefined ? { role } : {}), ...(status !== undefined ? { status } : {}) }
            : u,
        );
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }
      if (init.method === 'DELETE') {
        const { userId } = JSON.parse(String(init.body));
        current = current.filter((u) => u.id !== userId);
        return { ok: true, status: 204, json: async () => null } as Response;
      }
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

beforeEach(() => {
  setMockSession({
    user: { id: 'admin-1', name: 'Admin', email: 'admin@example.com', role: 'admin', status: 'APPROVED' },
    expires: '',
  });
});

describe('AdminUsersPanel', () => {
  test('renders a row per user with the right status badge', async () => {
    setupFetch();
    renderWithProviders(<AdminUsersPanel />);

    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  test('approving a user PATCHes and updates the row', async () => {
    const fetchMock = setupFetch();
    const { user } = renderWithProviders(<AdminUsersPanel />);
    await screen.findByText('Jane Doe');

    await user.click(screen.getByRole('button', { name: 'Actions for Jane Doe' }));
    await user.click(await screen.findByText('Approve'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/users',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ userId: 'u1', status: 'APPROVED' }),
        }),
      );
    });
    expect(await screen.findByText('Approved')).toBeInTheDocument();
  });

  test('rejecting asks for confirmation first and does nothing on cancel', async () => {
    const fetchMock = setupFetch();
    const { user } = renderWithProviders(<AdminUsersPanel />);
    await screen.findByText('Jane Doe');

    await user.click(screen.getByRole('button', { name: 'Actions for Jane Doe' }));
    await user.click(await screen.findByText('Reject'));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/admin/users',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  test('the role dropdown PATCHes the new role', async () => {
    const fetchMock = setupFetch();
    const { user } = renderWithProviders(<AdminUsersPanel />);
    await screen.findByText('Jane Doe');

    await user.click(screen.getByRole('button', { name: 'User' }));
    await user.click(await screen.findByText('Admin'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/users',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ userId: 'u1', role: 'admin' }),
        }),
      );
    });
  });

  test('a mutation invalidates the list so the table reflects the server afterward', async () => {
    const fetchMock = setupFetch();
    const { user } = renderWithProviders(<AdminUsersPanel />);
    await screen.findByText('Jane Doe');

    await user.click(screen.getByRole('button', { name: 'Actions for Jane Doe' }));
    await user.click(await screen.findByText('Delete'));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/users',
        expect.objectContaining({
          method: 'DELETE',
          body: JSON.stringify({ userId: 'u1' }),
        }),
      );
    });
    // The mutation only invalidated the list key; this row is gone only
    // because the refetch it triggered hit the (now-updated) mock server.
    await waitFor(() => expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument());
  });
});
