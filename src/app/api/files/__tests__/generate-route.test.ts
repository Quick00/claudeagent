import { POST } from '@/app/api/files/generate/route';
import { createGeneratedFile } from '@/lib/generated-files';

jest.mock('@/lib/generated-files', () => ({ createGeneratedFile: jest.fn() }));
const mockCreate = createGeneratedFile as jest.Mock;

function req(body: unknown, secret = 's') {
  return new Request('http://localhost/api/files/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.KNOWLEDGE_API_SECRET = 's';
  jest.clearAllMocks();
});

describe('POST /api/files/generate', () => {
  it('401 on a bad secret', async () => {
    expect((await POST(req({ provenanceKey: 'm1' }, 'bad'))).status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('401 when no secret is configured', async () => {
    delete process.env.KNOWLEDGE_API_SECRET;
    expect((await POST(req({ provenanceKey: 'm1' }, 'undefined'))).status).toBe(401);
  });

  it('400 without a provenance key', async () => {
    expect((await POST(req({ format: 'pdf' }))).status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('passes the rest of the body to the generator and returns the file', async () => {
    mockCreate.mockResolvedValue({ ok: true, file: { id: 'a1', filename: 'x.pdf', mimeType: 'application/pdf', size: 3 } });
    const res = await POST(req({ provenanceKey: 'm1', format: 'pdf', filename: 'x', content: '# hi' }));
    expect(mockCreate).toHaveBeenCalledWith('m1', { format: 'pdf', filename: 'x', content: '# hi' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'a1', filename: 'x.pdf' });
  });

  it('returns the generator error as text with its status', async () => {
    mockCreate.mockResolvedValue({ ok: false, status: 400, error: 'Sheet "A" has more than 50 columns.' });
    const res = await POST(req({ provenanceKey: 'm1', format: 'xlsx' }));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Sheet "A" has more than 50 columns.');
  });
});
