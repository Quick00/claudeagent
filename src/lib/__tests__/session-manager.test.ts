import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const mockSpawn = jest.fn();
jest.mock('child_process', () => ({ spawn: (...args: unknown[]) => mockSpawn(...args) }));
jest.mock('@/lib/config', () => ({
  config: {
    maxConcurrentSessions: 5,
    claudeMaxTurns: 25,
    claudeDisallowedTools: ['Bash', 'Task'],
  },
}));
jest.mock('@/lib/mcp-connections', () => ({
  getUsableConnectionsForSession: jest.fn().mockResolvedValue({ entries: [], dropped: [] }),
}));

function fakeChild() {
  const proc = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; pid: number };
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.pid = 123;
  return proc;
}

describe('SessionManager spawn arguments', () => {
  let sessionsDir: string;
  let SessionManager: typeof import('@/lib/session-manager').SessionManager;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSpawn.mockImplementation(() => fakeChild());
    // A real temp directory, not a mocked `fs`: the new file-based MCP
    // config has to actually exist on disk for these tests to read back.
    sessionsDir = mkdtempSync(path.join(tmpdir(), 'session-manager-test-'));
    process.env.SESSIONS_DIR = sessionsDir;
    jest.resetModules();
    ({ SessionManager } = await import('@/lib/session-manager'));
  });

  afterEach(() => {
    rmSync(sessionsDir, { recursive: true, force: true });
  });

  it('passes --disallowedTools and the provenance key to the MCP server on start', async () => {
    const sm = new SessionManager();
    await sm.startSession('r1', 'hi', 'sys', 'tok', 'u1', ['/repos/1'], 'msg-1');
    const args = mockSpawn.mock.calls[0][1] as string[];
    const idx = args.indexOf('--disallowedTools');
    expect(idx).toBeGreaterThan(-1);
    expect(args.slice(idx + 1, idx + 3)).toEqual(['Bash', 'Task']);
    expect(args).toContain('--strict-mcp-config');
    const configPath = args[args.indexOf('--mcp-config') + 1];
    const mcp = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(mcp.mcpServers.knowledge.env.PROVENANCE_KEY).toBe('msg-1');
    expect(mcp.mcpServers.knowledge.env.REPOSITORY_ID).toBeUndefined();
    expect(mcp.mcpServers.knowledge.env.KNOWLEDGE_VERIFY_URL).toBe(
      mcp.mcpServers.knowledge.env.KNOWLEDGE_SEARCH_URL.replace(/\/search$/, '/verify-result'),
    );
  });

  it('does the same on resume', async () => {
    const sm = new SessionManager();
    await sm.resumeSession('r1', 'sess', 'hi', 'tok', 'u1', 'msg-2');
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain('--disallowedTools');
    const configPath = args[args.indexOf('--mcp-config') + 1];
    const mcp = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(mcp.mcpServers.knowledge.env.PROVENANCE_KEY).toBe('msg-2');
  });

  it('adds a connected MCP server as a remote http entry with a Bearer header, and never logs the token', async () => {
    const { getUsableConnectionsForSession } = jest.requireMock('@/lib/mcp-connections') as {
      getUsableConnectionsForSession: jest.Mock;
    };
    getUsableConnectionsForSession.mockResolvedValueOnce({
      entries: [{ name: 'sentry', transport: 'HTTP', url: 'https://mcp.sentry.dev/mcp', accessToken: 'secret-token-xyz' }],
      dropped: [],
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const sm = new SessionManager();
    await sm.startSession('r1', 'hi', 'sys', 'tok', 'u1', ['/repos/1'], 'msg-1');

    const args = mockSpawn.mock.calls[0][1] as string[];
    const configPath = args[args.indexOf('--mcp-config') + 1];
    const mcp = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(mcp.mcpServers.sentry).toEqual({
      type: 'http',
      url: 'https://mcp.sentry.dev/mcp',
      headers: { Authorization: 'Bearer secret-token-xyz' },
    });

    const loggedText = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(loggedText).not.toContain('secret-token-xyz');
    logSpy.mockRestore();
  });

  it('exposes dropped servers for the caller to read once', async () => {
    const { getUsableConnectionsForSession } = jest.requireMock('@/lib/mcp-connections') as {
      getUsableConnectionsForSession: jest.Mock;
    };
    getUsableConnectionsForSession.mockResolvedValueOnce({ entries: [], dropped: [{ name: 'acme', reason: 'unreachable' }] });

    const sm = new SessionManager();
    await sm.startSession('r1', 'hi', 'sys', 'tok', 'u1', ['/repos/1'], 'msg-1');

    expect(sm.takeDroppedServers('r1')).toEqual([{ name: 'acme', reason: 'unreachable' }]);
    expect(sm.takeDroppedServers('r1')).toEqual([]); // read-once
  });
});
