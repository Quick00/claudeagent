import { describe, expect, test, beforeEach, jest } from '@jest/globals';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import { KnowledgeDashboard } from './KnowledgeDashboard';

const dashboardData = {
  isAdmin: false,
  stats: {
    totalEntries: 5,
    totalConversations: 2,
    totalMessages: 40,
    categories: { terminology: 3, product_insight: 2 },
  },
  tags: [{ tag: 'widgets', count: 3 }],
  entries: [
    {
      id: 'entry-1',
      subject: 'Widget lifecycle',
      category: 'terminology',
      content: 'A widget moves through draft, review, and published states.',
      tags: 'widgets',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
  ],
  entriesByDay: {},
  recentConversations: [
    { id: 'conv-1', title: 'How do widgets work?', createdAt: '2026-09-01T00:00:00.000Z', userName: 'Ana' },
  ],
};

const searchEntry = {
  id: 'entry-2',
  subject: 'Widget pricing',
  category: 'product_insight',
  content: 'Widgets are priced per seat.',
  tags: 'widgets,pricing',
  createdAt: '2026-09-02T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
  similarity: 91,
};

function jsonResponse(data: unknown): Response {
  return { ok: true, json: async () => data } as Response;
}

describe('KnowledgeDashboard', () => {
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  test('renders the fetched entries and stats', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(dashboardData));

    renderWithProviders(<KnowledgeDashboard />);

    expect(await screen.findByText('Widget lifecycle')).toBeInTheDocument();
    expect(screen.getByText('Knowledge Pages')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('How do widgets work?')).toBeInTheDocument();
  });

  test('typing in the search box debounces and refetches from the search endpoint', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(dashboardData))
      .mockResolvedValueOnce(jsonResponse({ entries: [searchEntry] }));

    const { user } = renderWithProviders(<KnowledgeDashboard />);
    await screen.findByText('Widget lifecycle');

    const input = screen.getByLabelText('Search knowledge');
    await user.type(input, 'pricing');

    await waitFor(
      () => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/dashboard/search',
          expect.objectContaining({ method: 'POST' }),
        );
      },
      { timeout: 3000 },
    );

    expect(await screen.findByText('Widget pricing')).toBeInTheDocument();
  });

  test('renders the empty state, not a bare string, when a search finds nothing', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(dashboardData))
      .mockResolvedValueOnce(jsonResponse({ entries: [] }));

    const { user } = renderWithProviders(<KnowledgeDashboard />);
    await screen.findByText('Widget lifecycle');

    const input = screen.getByLabelText('Search knowledge');
    await user.type(input, 'nothingmatches');

    const emptyTitle = await screen.findByText('No matching knowledge found', {}, { timeout: 3000 });
    expect(emptyTitle.closest('[data-slot="empty"]')).not.toBeNull();
  });
});
