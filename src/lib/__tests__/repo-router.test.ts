import { routeQuestion } from '@/lib/repo-router';

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('repo-router', () => {
  const repos = [
    { id: 'repo-1', name: 'Billing Service', description: 'Handles invoices and payments' },
    { id: 'repo-2', name: 'Customer Portal', description: 'Frontend for customer self-service' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPENROUTER_API_KEY = 'test-key';
  });

  it('returns the repo ID chosen by the model', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'repo-1' } }],
      }),
    });

    const result = await routeQuestion('How does invoice generation work?', repos);
    expect(result).toBe('repo-1');
  });

  it('returns the single repo when only one exists', async () => {
    const result = await routeQuestion('Any question', [repos[0]]);
    expect(result).toBe('repo-1');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws when the model returns an invalid repo ID', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'nonexistent-id' } }],
      }),
    });

    await expect(routeQuestion('question', repos)).rejects.toThrow('Could not determine');
  });
});
