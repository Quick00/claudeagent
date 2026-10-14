import { mkdtemp, writeFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { GET } from '@/app/api/upload/[id]/route';
import { requireApprovedUser } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';

jest.mock('@/lib/api-auth', () => ({ requireApprovedUser: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: { attachment: { findUnique: jest.fn() } } }));

const mockAuth = requireApprovedUser as jest.Mock;
const mockFind = prisma.attachment.findUnique as jest.Mock;
const params = { params: Promise.resolve({ id: 'att-1' }) };
const request = () => new Request('http://localhost/api/upload/att-1');

let dir: string;
let storagePath: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'upload-route-'));
  storagePath = path.join(dir, 'att-1.csv');
  await writeFile(storagePath, 'a,b\n1,2\n');
});

afterAll(() => rm(dir, { recursive: true, force: true }));

function attachment(overrides: Record<string, unknown>) {
  return {
    id: 'att-1',
    filename: 'export.csv',
    storagePath,
    mimeType: 'text/csv',
    size: 8,
    uploadedById: 'alice',
    message: null,
    ...overrides,
  };
}

function signIn(id: string, role = 'user') {
  mockAuth.mockResolvedValue({ ok: true, user: { id, role } });
}

beforeEach(() => jest.clearAllMocks());

describe('GET /api/upload/[id]', () => {
  test('an upload not yet in a message is served to its uploader only', async () => {
    mockFind.mockResolvedValue(attachment({}));

    signIn('alice');
    expect((await GET(request(), params)).status).toBe(200);

    signIn('bob');
    expect((await GET(request(), params)).status).toBe(403);
  });

  test('an upload from before uploaders were recorded is admin-only until it is in a message', async () => {
    mockFind.mockResolvedValue(attachment({ uploadedById: null }));

    signIn('bob');
    expect((await GET(request(), params)).status).toBe(403);

    signIn('root', 'admin');
    expect((await GET(request(), params)).status).toBe(200);
  });

  test("once in a message, the conversation's owner decides, not the uploader", async () => {
    mockFind.mockResolvedValue(attachment({ message: { conversation: { userId: 'carol' } } }));

    signIn('carol');
    expect((await GET(request(), params)).status).toBe(200);

    signIn('alice');
    expect((await GET(request(), params)).status).toBe(403);
  });

  test('text downloads as plain text and is never sniffed into a page', async () => {
    mockFind.mockResolvedValue(attachment({}));
    signIn('alice');

    const res = await GET(request(), params);

    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="export.csv"');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
