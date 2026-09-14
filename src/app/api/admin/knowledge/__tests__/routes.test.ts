import { GET, POST } from '@/app/api/admin/knowledge/route';
import { PATCH as PATCH_ENTRY } from '@/app/api/admin/knowledge/[id]/route';
import { POST as VERIFY } from '@/app/api/admin/knowledge/[id]/verify/route';
import { PATCH as PATCH_REVIEW } from '@/app/api/admin/knowledge/reviews/[id]/route';
import { requireAdminUser } from '@/lib/api-auth';
import { buildAttention } from '@/lib/knowledge-attention';
import { updateEntry, createPinnedEntry } from '@/lib/knowledge-admin';
import { runTier1 } from '@/lib/knowledge-verifier';
import { startTier2, reconcileStrandedRuns } from '@/lib/knowledge-verify-run';
import { resolveReview } from '@/lib/knowledge-reviews';

jest.mock('@/lib/api-auth', () => ({ requireAdminUser: jest.fn() }));
jest.mock('@/lib/knowledge-attention', () => ({ buildAttention: jest.fn() }));
jest.mock('@/lib/knowledge-admin', () => ({ updateEntry: jest.fn(), createPinnedEntry: jest.fn() }));
jest.mock('@/lib/knowledge-verifier', () => ({ runTier1: jest.fn() }));
jest.mock('@/lib/knowledge-verify-run', () => ({ startTier2: jest.fn(), reconcileStrandedRuns: jest.fn().mockResolvedValue(0) }));
jest.mock('@/lib/knowledge-reviews', () => ({ resolveReview: jest.fn() }));
jest.mock('@/lib/crypto', () => ({ decrypt: (s: string) => `dec:${s}` }));

const mockAuth = requireAdminUser as jest.Mock;
const admin = { id: 'a1', role: 'admin', claudeToken: 'enc' };
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (body: unknown, method = 'POST') =>
  new Request('http://localhost', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ ok: true, user: admin });
});

describe('admin knowledge routes', () => {
  it('GET returns attention and refuses non-admins', async () => {
    (buildAttention as jest.Mock).mockResolvedValue({ stale: [], unverified: [], pinned: [], reviews: [], syncs: [] });
    expect((await GET()).status).toBe(200);
    mockAuth.mockResolvedValue({ ok: false, response: new Response('Forbidden', { status: 403 }) });
    expect((await GET()).status).toBe(403);
  });

  it('POST creates a pinned entry and validates fields', async () => {
    (createPinnedEntry as jest.Mock).mockResolvedValue('p1');
    const res = await POST(json({ subject: 'S', content: 'C', category: 'process', tags: 't' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'p1' });
    expect((await POST(json({ subject: 'S' }))).status).toBe(400);
  });

  it('PATCH entry forwards the patch and maps validation errors to 400', async () => {
    const res = await PATCH_ENTRY(json({ kind: 'pinned' }, 'PATCH'), params('e1'));
    expect(res.status).toBe(200);
    expect(updateEntry).toHaveBeenCalledWith('e1', { kind: 'pinned' });
    (updateEntry as jest.Mock).mockRejectedValue(new Error('Invalid category'));
    expect((await PATCH_ENTRY(json({ category: 'x' }, 'PATCH'), params('e1'))).status).toBe(400);
  });

  it('verify tier 1 runs runTier1', async () => {
    (runTier1 as jest.Mock).mockResolvedValue({ runId: 'r', outcome: 'confirmed', reason: 'ok' });
    const res = await VERIFY(json({ tier: 1 }), params('e1'));
    expect(res.status).toBe(200);
    expect(runTier1).toHaveBeenCalledWith('e1', 'a1');
  });

  it('verify tier 1 answers 409 rather than an unhandled 500 when the run cannot even be recorded', async () => {
    (runTier1 as jest.Mock).mockRejectedValue(new Error('db down'));
    const res = await VERIFY(json({ tier: 1 }), params('e1'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'db down' });
  });

  it('GET reconciles stranded verification runs before building the panel', async () => {
    (buildAttention as jest.Mock).mockResolvedValue({ stale: [], unverified: [], pinned: [], reviews: [], syncs: [] });
    await GET();
    expect(reconcileStrandedRuns).toHaveBeenCalled();
  });

  it('verify tier 2 needs a linked Claude token and passes the decrypted token', async () => {
    (startTier2 as jest.Mock).mockResolvedValue({ runId: 'r', outcome: 'changed', reason: 'x', costUsd: 0.4 });
    const res = await VERIFY(json({ tier: 2 }), params('e1'));
    expect(res.status).toBe(200);
    expect(startTier2).toHaveBeenCalledWith('e1', { id: 'a1', claudeToken: 'dec:enc' });
    mockAuth.mockResolvedValue({ ok: true, user: { ...admin, claudeToken: null } });
    expect((await VERIFY(json({ tier: 2 }), params('e1'))).status).toBe(409);
  });

  it('verify rejects other tiers', async () => {
    expect((await VERIFY(json({ tier: 3 }), params('e1'))).status).toBe(400);
  });

  it('PATCH review resolves and maps errors to 409', async () => {
    expect((await PATCH_REVIEW(json({ action: 'accept' }, 'PATCH'), params('r1'))).status).toBe(200);
    expect(resolveReview).toHaveBeenCalledWith('r1', 'accept', 'a1');
    expect((await PATCH_REVIEW(json({ action: 'nope' }, 'PATCH'), params('r1'))).status).toBe(400);
    (resolveReview as jest.Mock).mockRejectedValue(new Error('Review already resolved'));
    expect((await PATCH_REVIEW(json({ action: 'dismiss' }, 'PATCH'), params('r1'))).status).toBe(409);
  });
});
