import { POST } from '@/app/api/admin/conversations/[id]/messages/route';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

jest.mock('next-auth');
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    conversation: { findUnique: jest.fn() },
    message: { create: jest.fn(), createMany: jest.fn() },
    flag: { updateMany: jest.fn() },
    repository: { findMany: jest.fn() },
    appSetting: { findUnique: jest.fn(), upsert: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock('@/lib/session-manager', () => ({
  sessionManager: { resumeSession: jest.fn(), takeDroppedServers: jest.fn(() => []) },
}));
jest.mock('@/lib/crypto', () => ({ decrypt: (s: string) => `dec(${s})` }));

const mockSession = getServerSession as jest.Mock;
const mockUserFind = prisma.user.findUnique as jest.Mock;
const mockConvFind = prisma.conversation.findUnique as jest.Mock;

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (body: object) =>
  new Request('http://x', { method: 'POST', body: JSON.stringify(body) });

describe('POST /api/admin/conversations/[id]/messages — guards', () => {
  beforeEach(() => jest.clearAllMocks());

  it('401 when not authenticated', async () => {
    mockSession.mockResolvedValue(null);
    const res = await POST(req({ content: 'hi' }), params('c1'));
    expect(res.status).toBe(401);
  });

  it('403 when authenticated user is not admin', async () => {
    mockSession.mockResolvedValue({ user: { email: 'u@example.com' } });
    mockUserFind.mockResolvedValue({ id: 'u1', role: 'user' });
    const res = await POST(req({ content: 'hi' }), params('c1'));
    expect(res.status).toBe(403);
  });

  it('400 when admin is the conversation owner', async () => {
    mockSession.mockResolvedValue({ user: { email: 'a@example.com' } });
    mockUserFind.mockResolvedValue({ id: 'a1', role: 'admin' });
    mockConvFind.mockResolvedValue({
      id: 'c1', userId: 'a1', claudeSessionId: 's', repositoryId: null,
      user: { id: 'a1', claudeToken: 'enc' },
    });
    const res = await POST(req({ content: 'hi' }), params('c1'));
    expect(res.status).toBe(400);
  });

  it('404 when conversation does not exist', async () => {
    mockSession.mockResolvedValue({ user: { email: 'a@example.com' } });
    mockUserFind.mockResolvedValue({ id: 'a1', role: 'admin' });
    mockConvFind.mockResolvedValue(null);
    const res = await POST(req({ content: 'hi' }), params('c1'));
    expect(res.status).toBe(404);
  });

  it('409 when owner has no claudeToken', async () => {
    mockSession.mockResolvedValue({ user: { email: 'a@example.com' } });
    mockUserFind.mockResolvedValue({ id: 'a1', role: 'admin' });
    mockConvFind.mockResolvedValue({
      id: 'c1', userId: 'u-other', claudeSessionId: 's', repositoryId: null,
      user: { id: 'u-other', claudeToken: null },
    });
    const res = await POST(req({ content: 'hi' }), params('c1'));
    expect(res.status).toBe(409);
  });

  it('409 when conversation has no claudeSessionId', async () => {
    mockSession.mockResolvedValue({ user: { email: 'a@example.com' } });
    mockUserFind.mockResolvedValue({ id: 'a1', role: 'admin' });
    mockConvFind.mockResolvedValue({
      id: 'c1', userId: 'u-other', claudeSessionId: null, repositoryId: null,
      user: { id: 'u-other', claudeToken: 'enc' },
    });
    const res = await POST(req({ content: 'hi' }), params('c1'));
    expect(res.status).toBe(409);
  });

  it('400 when content is empty', async () => {
    mockSession.mockResolvedValue({ user: { email: 'a@example.com' } });
    mockUserFind.mockResolvedValue({ id: 'a1', role: 'admin' });
    mockConvFind.mockResolvedValue({
      id: 'c1', userId: 'u-other', claudeSessionId: 's', repositoryId: null,
      user: { id: 'u-other', claudeToken: 'enc' },
    });
    const res = await POST(req({ content: '   ' }), params('c1'));
    expect(res.status).toBe(400);
  });
});

import { sessionManager } from '@/lib/session-manager';
import { config } from '@/lib/config';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { drainSse } from '../helpers/sse';

const mockMsgCreate = prisma.message.create as jest.Mock;
const mockFlagUpdate = prisma.flag.updateMany as jest.Mock;
const mockRepoFind = prisma.repository.findMany as jest.Mock;
const mockTx = prisma.$transaction as jest.Mock;
const mockResume = sessionManager.resumeSession as jest.Mock;

describe('POST /api/admin/conversations/[id]/messages — happy path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMsgCreate.mockResolvedValue({ id: 'admin-msg-1' });
    mockFlagUpdate.mockResolvedValue({ count: 1 });
    mockRepoFind.mockResolvedValue([]);
    mockTx.mockImplementation((ops) => Promise.all(ops.map((p: Promise<unknown>) => p)));
  });

  it('persists admin message with sentByAdminId and seenByOwner=false, flips PENDING flags', async () => {
    mockSession.mockResolvedValue({ user: { email: 'a@example.com' } });
    mockUserFind.mockResolvedValue({ id: 'a1', role: 'admin' });
    mockConvFind.mockResolvedValue({
      id: 'c1', userId: 'u-other', claudeSessionId: 'sess-1', repositoryId: 'r1',
      user: { id: 'u-other', claudeToken: 'enc' },
    });

    const fakeProc = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    mockResume.mockReturnValue(fakeProc);

    const res = await POST(req({ content: 'Hello from admin' }), params('c1'));
    expect(res.status).toBe(200);

    // Inspect the transaction operations recorded
    expect(mockMsgCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        conversationId: 'c1',
        role: 'user',
        content: 'Hello from admin',
        sentByAdminId: 'a1',
        seenByOwner: false,
      }),
    }));
    expect(mockFlagUpdate).toHaveBeenCalledWith({
      where: { conversationId: 'c1', status: 'PENDING' },
      data: expect.objectContaining({
        status: 'RESPONDED',
        adminId: 'a1',
      }),
    });
    expect(mockResume).toHaveBeenCalledWith(
      expect.stringContaining('admin-c1-'),
      'sess-1',
      // A resumed run gets no system prompt, so the reminder rides on the message.
      config.responseReminder + 'Hello from admin',
      'dec(enc)',
      'u-other',
      'admin-msg-1',
    );
  });
});

describe('POST /api/admin/conversations/[id]/messages — the answer it stores', () => {
  const mockMsgCreateMany = prisma.message.createMany as jest.Mock;
  const tick = () => new Promise((r) => setImmediate(r));
  const textLine = (text: string) =>
    JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } }) + '\n';
  const toolLine = (name: string) =>
    JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name } } }) + '\n';

  beforeEach(() => {
    jest.clearAllMocks();
    mockSession.mockResolvedValue({ user: { email: 'a@example.com' } });
    mockUserFind.mockResolvedValue({ id: 'a1', role: 'admin' });
    mockConvFind.mockResolvedValue({
      id: 'c1', userId: 'u-other', claudeSessionId: 'sess-1',
      user: { id: 'u-other', claudeToken: 'enc' },
    });
    mockMsgCreate.mockResolvedValue({ id: 'admin-msg-1', createdAt: new Date('2026-01-01T10:00:00.000Z') });
    mockMsgCreateMany.mockResolvedValue({ count: 1 });
    mockFlagUpdate.mockResolvedValue({ count: 0 });
    mockRepoFind.mockResolvedValue([]);
    mockTx.mockImplementation((ops) => Promise.all(ops.map((p: Promise<unknown>) => p)));
  });

  it('drops a leaky note, sanitizes the answer and stores one unseen row per bubble', async () => {
    const proc = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
    mockResume.mockReturnValue(proc);

    const res = await POST(req({ content: 'Hello from admin' }), params('c1'));
    proc.stdout.write(
      textLine('OK, repo 16310549 = Eventinsight.') +
        toolLine('Grep') +
        textLine('Looking into it.') +
        toolLine('Read') +
        textLine('It is set in src/Limits/SessionTagLimit.php per workshop.'),
    );
    await tick();
    proc.emit('close', 0);
    await tick();
    const events = await drainSse(res);

    expect(events.map((e) => e.type)).toContain('text_retract');
    const rows = (mockMsgCreateMany.mock.calls[0][0] as { data: Array<{ content: string; seenByOwner: boolean }> }).data;
    expect(rows.map((r) => r.content)).toEqual(['Looking into it.', 'It is set in per workshop.']);
    expect(rows.every((r) => r.seenByOwner === false)).toBe(true);
  });
});
