import { POST } from '@/app/api/knowledge/verify-result/route';
import { applyVerificationResult } from '@/lib/knowledge-verify-run';

jest.mock('@/lib/knowledge-verify-run', () => ({ applyVerificationResult: jest.fn() }));
const mockApply = applyVerificationResult as jest.Mock;

function req(body: unknown, secret = 's') {
  return new Request('http://localhost/api/knowledge/verify-result', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.KNOWLEDGE_API_SECRET = 's';
  jest.clearAllMocks();
  mockApply.mockResolvedValue(undefined);
});

describe('POST /api/knowledge/verify-result', () => {
  it('401 on a bad secret, without applying anything', async () => {
    const res = await POST(req({ runId: 'r', entryId: 'e', outcome: 'confirmed' }, 'bad'));
    expect(res.status).toBe(401);
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('401 when no secret is configured, so a missing env var is not an open door', async () => {
    delete process.env.KNOWLEDGE_API_SECRET;
    const res = await POST(req({ runId: 'r', entryId: 'e', outcome: 'confirmed' }, 'undefined'));
    expect(res.status).toBe(401);
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('400 on an invalid outcome', async () => {
    const res = await POST(req({ runId: 'r', entryId: 'e', outcome: 'meh' }));
    expect(res.status).toBe(400);
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('400 on a missing run id', async () => {
    const res = await POST(req({ entryId: 'e', outcome: 'confirmed' }));
    expect(res.status).toBe(400);
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('400 on a missing entry id', async () => {
    const res = await POST(req({ runId: 'r', outcome: 'confirmed' }));
    expect(res.status).toBe(400);
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('400 on a body that is not JSON', async () => {
    const res = await POST(new Request('http://localhost/api/knowledge/verify-result', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer s' },
      body: 'not json',
    }));
    expect(res.status).toBe(400);
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('applies and returns ok', async () => {
    const res = await POST(req({ runId: 'r', entryId: 'e', outcome: 'changed', content: 'c' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockApply).toHaveBeenCalledWith({ runId: 'r', entryId: 'e', outcome: 'changed', content: 'c', subject: undefined, tags: undefined });
  });

  it('drops non-string optional fields rather than passing them through', async () => {
    await POST(req({ runId: 'r', entryId: 'e', outcome: 'confirmed', subject: { evil: true }, tags: 7 }));
    expect(mockApply).toHaveBeenCalledWith({ runId: 'r', entryId: 'e', outcome: 'confirmed', content: undefined, subject: undefined, tags: undefined });
  });

  it('409 when apply rejects the result', async () => {
    mockApply.mockRejectedValue(new Error('Run is not pending'));
    const res = await POST(req({ runId: 'r', entryId: 'e', outcome: 'confirmed' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Run is not pending' });
  });
});
