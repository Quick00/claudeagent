import { POST } from '@/app/api/knowledge/search/route';
import { retrieveKnowledge } from '@/lib/knowledge-context';

jest.mock('@/lib/knowledge-context', () => ({ retrieveKnowledge: jest.fn() }));
const mockRetrieve = retrieveKnowledge as jest.Mock;

function req(body: unknown, secret = 'test-secret') {
  return new Request('http://localhost/api/knowledge/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
}

describe('POST /api/knowledge/search', () => {
  beforeEach(() => {
    process.env.KNOWLEDGE_API_SECRET = 'test-secret';
    jest.clearAllMocks();
  });

  it('rejects a bad secret', async () => {
    const res = await POST(req({ query: 'x' }, 'wrong'));
    expect(res.status).toBe(401);
  });

  it('returns freshness fields', async () => {
    mockRetrieve.mockResolvedValue([
      { id: '1', subject: 'S', category: 'c', content: 'k', tags: 't', kind: 'derived', similarity: 0.9, verifiedAt: null, freshness: { state: 'stale', changedPaths: ['a.php'] } },
      { id: '2', subject: 'P', category: 'c', content: 'k2', tags: '', kind: 'pinned', similarity: 0.8, verifiedAt: null, freshness: { state: 'fresh' } },
    ]);
    const res = await POST(req({ query: 'badges', limit: 5 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.entries).toEqual([
      { id: '1', subject: 'S', category: 'c', content: 'k', tags: 't', kind: 'derived', freshness: 'stale', changedPaths: ['a.php'] },
      { id: '2', subject: 'P', category: 'c', content: 'k2', tags: '', kind: 'pinned', freshness: 'fresh', changedPaths: [] },
    ]);
    expect(mockRetrieve).toHaveBeenCalledWith('badges', 5);
  });
});
