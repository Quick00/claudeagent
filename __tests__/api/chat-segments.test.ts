/**
 * An answer that runs a tool mid-way is several bubbles, not one: the route
 * splits the text at each tool call, announces the split with `text_break`,
 * and persists the same split as one assistant row per segment.
 */
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { POST } from '@/app/api/chat/route';
import { prisma } from '@/lib/prisma';
import { sessionManager } from '@/lib/session-manager';
import { requireApprovedUser } from '@/lib/api-auth';
import { recordMcpServerStatus } from '@/lib/mcp-connections';
import { drainSse } from '../helpers/sse';

jest.mock('@/lib/api-auth', () => ({ requireApprovedUser: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    repository: { findMany: jest.fn() },
    conversation: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    message: { create: jest.fn(), createMany: jest.fn() },
    attachment: { findMany: jest.fn(), updateMany: jest.fn() },
    mcpServerConnection: { findMany: jest.fn() },
  },
}));
jest.mock('@/lib/session-manager', () => ({
  sessionManager: { startSession: jest.fn(), resumeSession: jest.fn(), takeDroppedServers: jest.fn() },
}));
jest.mock('@/lib/mcp-connections', () => ({ recordMcpServerStatus: jest.fn(async () => undefined) }));
jest.mock('@/lib/crypto', () => ({ decrypt: (s: string) => `dec(${s})` }));
jest.mock('@/lib/knowledge-context', () => ({
  retrieveKnowledge: jest.fn(async () => []),
  formatKnowledgeBlock: () => '',
  formatKnowledgeDelta: () => '',
}));
jest.mock('@/lib/settings', () => ({ getKnowledgeIgnoreLists: jest.fn(async () => undefined) }));
jest.mock('@/lib/provenance-collector', () => ({
  provenanceCollector: { start: jest.fn(), end: jest.fn(), recordToolUse: jest.fn() },
}));

const mockAuth = requireApprovedUser as jest.Mock;
const mockRepos = prisma.repository.findMany as jest.Mock;
const mockConvFind = prisma.conversation.findFirst as jest.Mock;
const mockMsgCreate = prisma.message.create as jest.Mock;
const mockMsgCreateMany = prisma.message.createMany as jest.Mock;
const mockResume = sessionManager.resumeSession as jest.Mock;
const mockDropped = sessionManager.takeDroppedServers as jest.Mock;
const mockRecordStatus = recordMcpServerStatus as jest.Mock;
const mockStart = sessionManager.startSession as jest.Mock;
const mockLinkedServers = prisma.mcpServerConnection.findMany as jest.Mock;

// The route logs each close, and a failed/needs-auth MCP status, by design; keep the suite output clean.
const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
afterAll(() => {
  consoleLog.mockRestore();
  consoleError.mockRestore();
});

function fakeChild() {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    pid: number;
    kill: jest.Mock;
  };
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.pid = 123;
  proc.kill = jest.fn();
  return proc;
}

const tick = () => new Promise((r) => setImmediate(r));

/** A text delta as the CLI's `--output-format stream-json` emits it. */
const textLine = (text: string) =>
  JSON.stringify({
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
  }) + '\n';

/**
 * A tool call as the CLI emits it: `content_block_start` first, then the
 * complete `assistant` event. Both reach `onToolUse` — the duplication is real
 * (see the ['Read', 'Read'] assertion in claude-process-stream.test.ts) and the
 * route's boundary guard has to survive it.
 */
const toolLines = (name: string) =>
  JSON.stringify({
    type: 'stream_event',
    event: { type: 'content_block_start', content_block: { type: 'tool_use', name } },
  }) +
  '\n' +
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name }] } }) +
  '\n';

/** The CLI's init event, listing each configured MCP server's connection state. */
const initLine = (servers: Array<{ name: string; status: string }>) =>
  JSON.stringify({ type: 'system', subtype: 'init', mcp_servers: servers }) + '\n';

const USER_MESSAGE_AT = new Date('2026-01-01T10:00:00.000Z');

/**
 * Drive one turn: POST, feed the CLI's stdout lines, close the process, and
 * return the frames the client would have seen.
 */
async function runTurn(lines: string) {
  const proc = fakeChild();
  mockResume.mockResolvedValue(proc);

  const res = await POST(
    new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ conversationId: 'conv-1', message: 'How does it work?' }),
    }),
  );

  await tick();
  proc.stdout.write(lines);
  await tick();
  proc.emit('close', 0);
  await tick();

  return drainSse(res);
}

/** The `data` rows of the single `createMany` the turn should have made. */
function writtenRows() {
  expect(mockMsgCreateMany).toHaveBeenCalledTimes(1);
  return (mockMsgCreateMany.mock.calls[0][0] as {
    data: { content: string; createdAt: Date; role: string }[];
  }).data;
}

describe('POST /api/chat — one assistant row per text segment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({
      ok: true,
      user: { id: 'u1', claudeToken: 'enc', role: 'user' },
    });
    mockRepos.mockResolvedValue([
      { name: 'app', description: 'the app', localPath: '/repos/app', lastPulledAt: null, gitlabProjectId: '1' },
    ]);
    mockConvFind.mockResolvedValue({ id: 'conv-1', claudeSessionId: 'sess-1' });
    mockMsgCreate.mockResolvedValue({ id: 'um1', createdAt: USER_MESSAGE_AT });
    mockMsgCreateMany.mockResolvedValue({ count: 1 });
    mockDropped.mockReturnValue([]);
    mockLinkedServers.mockResolvedValue([]);
  });

  it('writes one row when no tool interrupts the answer', async () => {
    const events = await runTurn(textLine('It checks the badge. ') + textLine('Then it logs in.'));

    expect(writtenRows().map((r) => r.content)).toEqual(['It checks the badge. Then it logs in.']);
    expect(events.filter((e) => e.type === 'text_break')).toHaveLength(0);
  });

  it('writes two rows, in order, for a tool call between two blocks of text', async () => {
    const events = await runTurn(
      textLine('Found it. Let me read the code.') +
        toolLines('Read') +
        textLine('Good, that confirms it.'),
    );

    expect(writtenRows().map((r) => r.content)).toEqual([
      'Found it. Let me read the code.',
      'Good, that confirms it.',
    ]);
    // The tool_use duplication stays visible; only the break is deduplicated.
    expect(events.filter((e) => e.type === 'text_break')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'tool_use')).toHaveLength(2);
    // The break belongs to the text that ended, so it precedes the tool frames.
    const types = events.map((e) => e.type);
    expect(types.indexOf('text_break')).toBeLessThan(types.indexOf('tool_use'));
  });

  // `Message.createdAt` is TIMESTAMP(3). Rows that tie at the same millisecond
  // come back from `orderBy createdAt asc` in any order, which would scramble
  // the bubbles on reload — so the route supplies the timestamps itself.
  it('gives every row a distinct timestamp, after the question it answers', async () => {
    await runTurn(textLine('First.') + toolLines('Read') + textLine('Second.'));

    const rows = writtenRows();
    expect(rows[1].createdAt.getTime()).toBeGreaterThan(rows[0].createdAt.getTime());
    expect(rows[0].createdAt.getTime()).toBeGreaterThan(USER_MESSAGE_AT.getTime());
  });

  // Clock skew between the app and the DB must never sort an answer before its
  // own question, so the base is pinned past the user row.
  it('never timestamps a row before the user message, even with a skewed clock', async () => {
    const future = new Date(Date.now() + 60_000);
    mockMsgCreate.mockResolvedValue({ id: 'um1', createdAt: future });

    await runTurn(textLine('Answer.'));

    expect(writtenRows()[0].createdAt.getTime()).toBeGreaterThan(future.getTime());
  });

  it('writes no leading empty row for a tool called before any text', async () => {
    const events = await runTurn(toolLines('Grep') + textLine('Here is the answer.'));

    expect(writtenRows().map((r) => r.content)).toEqual(['Here is the answer.']);
    expect(events.filter((e) => e.type === 'text_break')).toHaveLength(0);
  });

  it('writes no trailing empty row for a tool called after the last text', async () => {
    await runTurn(textLine('All done.') + toolLines('mcp__knowledge__save_knowledge'));

    expect(writtenRows().map((r) => r.content)).toEqual(['All done.']);
  });

  it('sanitizes each segment on its own', async () => {
    await runTurn(
      textLine('Nothing to strip here.') +
        toolLines('Read') +
        textLine('The check lives in src/Controllers/CheckIn.php today.'),
    );

    const rows = writtenRows();
    expect(rows[0].content).toBe('Nothing to strip here.');
    expect(rows[1].content).not.toContain('CheckIn.php');
  });

  // A note Claude writes before a tool call is not the answer; one that names a
  // repo, file or class is taken back from the screen and never stored.
  it('retracts a leaky note before a tool call and writes only the answer', async () => {
    const events = await runTurn(
      textLine('OK, repo 16310549 = Eventinsight. Let me search within it.') +
        toolLines('Grep') +
        textLine('Short answer: yes.'),
    );

    expect(writtenRows().map((r) => r.content)).toEqual(['Short answer: yes.']);
    const types = events.map((e) => e.type);
    expect(types).toContain('text_retract');
    expect(types).not.toContain('text_break');
    expect(types.indexOf('text_retract')).toBeLessThan(types.indexOf('tool_use'));
  });

  it('writes nothing but still finishes when the answer is empty', async () => {
    const events = await runTurn('');

    expect(mockMsgCreateMany).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  it('emits an mcp_server_notice frame for a server dropped before the session started', async () => {
    mockDropped.mockReturnValueOnce([{ name: 'sentry', reason: 'refresh token revoked' }]);

    const events = await runTurn(textLine('Answer.'));

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'mcp_server_notice',
        server: 'sentry',
        message: expect.stringContaining('refresh token revoked'),
      }),
    );
  });

  it('emits an mcp_server_notice frame when a server fails mid-session per the init event', async () => {
    const events = await runTurn(initLine([{ name: 'sentry', status: 'failed' }]) + textLine('Answer.'));

    expect(events).toContainEqual(expect.objectContaining({ type: 'mcp_server_notice', server: 'sentry' }));
    expect(mockRecordStatus).toHaveBeenCalledWith('u1', 'sentry', 'failed');
  });

  it('does not notice the knowledge server or a healthy connection', async () => {
    const events = await runTurn(
      initLine([
        { name: 'knowledge', status: 'failed' },
        { name: 'sentry', status: 'connected' },
      ]) + textLine('Answer.'),
    );

    expect(events.filter((e) => e.type === 'mcp_server_notice')).toHaveLength(0);
    // A healthy report is still recorded — it is what clears a note an
    // earlier failure left in Settings — but the knowledge server never is.
    expect(mockRecordStatus).toHaveBeenCalledWith('u1', 'sentry', 'connected');
    expect(mockRecordStatus).not.toHaveBeenCalledWith('u1', 'knowledge', expect.anything());
  });
});

describe('POST /api/chat — what a connected source is for reaches the CLI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ ok: true, user: { id: 'u1', claudeToken: 'enc', role: 'user' } });
    // With no repo and no REPO_PATH the route answers 503 and never spawns.
    mockRepos.mockResolvedValue([
      { name: 'app', description: 'the app', localPath: '/repos/app', lastPulledAt: null, gitlabProjectId: '1' },
    ]);
    mockMsgCreate.mockResolvedValue({ id: 'um1', createdAt: USER_MESSAGE_AT });
    mockMsgCreateMany.mockResolvedValue({ count: 1 });
    mockDropped.mockReturnValue([]);
    mockLinkedServers.mockResolvedValue([
      { mcpServer: { name: 'jira', description: 'Customer tickets and their status.' } },
    ]);
  });

  async function runEmptyTurn(spawnMock: jest.Mock) {
    const proc = fakeChild();
    spawnMock.mockResolvedValue(proc);

    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        body: JSON.stringify({ conversationId: 'conv-1', message: 'Any open tickets about badges?' }),
      }),
    );

    await tick();
    proc.emit('close', 0);
    await tick();
    await drainSse(res);
  }

  it('describes the source in the system prompt of a fresh session', async () => {
    mockConvFind.mockResolvedValue({ id: 'conv-1', claudeSessionId: null });

    await runEmptyTurn(mockStart);

    const systemPrompt = mockStart.mock.calls[0][2] as string;
    expect(systemPrompt).toContain('jira');
    expect(systemPrompt).toContain('Customer tickets and their status.');
  });

  it('names the source in the message of a resumed turn, which gets no system prompt', async () => {
    mockConvFind.mockResolvedValue({ id: 'conv-1', claudeSessionId: 'sess-1' });

    await runEmptyTurn(mockResume);

    expect(mockResume.mock.calls[0][2] as string).toContain('jira');
  });

  // The provenance collection is already open by this point, so a throw here
  // would 500 the turn and leave that collection running for the message.
  it('still answers when the lookup fails, without describing any source', async () => {
    mockConvFind.mockResolvedValue({ id: 'conv-1', claudeSessionId: null });
    mockLinkedServers.mockRejectedValue(new Error('connection pool exhausted'));

    await runEmptyTurn(mockStart);

    expect(mockStart).toHaveBeenCalled();
    expect(mockStart.mock.calls[0][2] as string).not.toMatch(/CONNECTED SOURCES/);
  });

  it('says nothing about sources when the user has connected none', async () => {
    mockConvFind.mockResolvedValue({ id: 'conv-1', claudeSessionId: null });
    mockLinkedServers.mockResolvedValue([]);

    await runEmptyTurn(mockStart);

    expect(mockStart.mock.calls[0][2] as string).not.toMatch(/CONNECTED SOURCES/);
  });
});
