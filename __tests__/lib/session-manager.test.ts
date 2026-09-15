import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

jest.mock('@/lib/config', () => ({
  config: {
    repoPath: '/mock/eventinsight',
    maxConcurrentSessions: 2,
    sessionIdleTimeoutMs: 1000,
    claudeMaxTurns: 25,
    systemPrompt: 'Test prompt',
    claudeDisallowedTools: ['Bash', 'Task', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch'],
  },
}));

jest.mock('@/lib/mcp-connections', () => ({
  getUsableConnectionsForSession: jest.fn().mockResolvedValue({ entries: [], dropped: [] }),
}));

function createMockProcess(): ChildProcess {
  const proc = new EventEmitter() as ChildProcess & { stdin: { write: jest.Mock; end: jest.Mock } };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: jest.fn(), end: jest.fn() };
  proc.kill = jest.fn();
  proc.pid = Math.floor(Math.random() * 10000);
  return proc;
}

describe('SessionManager', () => {
  let SessionManager: typeof import('@/lib/session-manager').SessionManager;
  let sessionsDir: string;

  beforeEach(async () => {
    jest.resetModules();
    mockSpawn.mockReset();
    sessionsDir = mkdtempSync(path.join(tmpdir(), 'session-manager-test-'));
    process.env.SESSIONS_DIR = sessionsDir;
    const mod = await import('@/lib/session-manager');
    SessionManager = mod.SessionManager;
  });

  afterEach(() => {
    rmSync(sessionsDir, { recursive: true, force: true });
  });

  it('spawns a new claude process for a new conversation', async () => {
    mockSpawn.mockReturnValue(createMockProcess());

    const manager = new SessionManager();
    await manager.startSession('msg-1', 'Hello', '', 'test-token', 'user-1', ['/mock/repo']);

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const args = mockSpawn.mock.calls[0];
    expect(args[0]).toBe('claude');
    expect(args[1]).toContain('--print');
    expect(args[1]).toContain('--output-format');
    expect(args[1]).toContain('stream-json');
    expect(args[1]).toContain('--add-dir');
    expect(args[1]).toContain('/mock/repo');
  });

  it('uses --resume for existing sessions', async () => {
    mockSpawn.mockReturnValue(createMockProcess());

    const manager = new SessionManager();
    await manager.resumeSession('msg-2', 'session-abc', 'Follow up', 'test-token', 'user-1');

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const args = mockSpawn.mock.calls[0];
    expect(args[1]).toContain('--resume');
    expect(args[1]).toContain('session-abc');
  });

  it('enforces max concurrent sessions via queue', async () => {
    const procs = [createMockProcess(), createMockProcess(), createMockProcess()];
    let spawnIndex = 0;
    mockSpawn.mockImplementation(() => procs[spawnIndex++]);

    const manager = new SessionManager();

    // Start 2 sessions (the max) — awaited, since building the MCP config
    // (even from a mock resolving immediately) still yields a microtask.
    await manager.startSession('msg-1', 'Hello 1', '', 'test-token', 'user-1', ['/mock/repo']);
    await manager.startSession('msg-2', 'Hello 2', '', 'test-token', 'user-1', ['/mock/repo']);

    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(manager.queueSize).toBe(0);

    // Third should be queued rather than spawned immediately — not awaited
    // yet, since it won't resolve until a slot frees up.
    const queued = manager.startSession('msg-3', 'Hello 3', '', 'test-token', 'user-1', ['/mock/repo']);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(manager.queueSize).toBe(1);

    // Complete first process — queued one should start
    procs[0].emit('close', 0);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockSpawn).toHaveBeenCalledTimes(3);
    expect(manager.queueSize).toBe(0);
    await queued;
  });

  it('rejects queued requests when killAll clears the queue, instead of hanging the caller', async () => {
    // A dropped queue entry used to leave its promise unsettled forever: the
    // caller never returned, and a verification run's row stayed "pending".
    const procs = [createMockProcess(), createMockProcess()];
    let spawnIndex = 0;
    mockSpawn.mockImplementation(() => procs[spawnIndex++]);

    const manager = new SessionManager();
    await manager.startSession('msg-1', 'Hello 1', '', 'test-token', 'user-1', ['/mock/repo'], 'k1');
    await manager.startSession('msg-2', 'Hello 2', '', 'test-token', 'user-1', ['/mock/repo'], 'k2');
    const queued = manager.startSession('msg-3', 'Hello 3', '', 'test-token', 'user-1', ['/mock/repo'], 'k3');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(manager.queueSize).toBe(1);

    manager.killAll();

    await expect(queued).rejects.toThrow(/queue was cleared/);
    expect(manager.queueSize).toBe(0);
  });

  it('rejects a queued request whose spawn throws when its turn comes', async () => {
    const first = createMockProcess();
    mockSpawn.mockImplementationOnce(() => first)
      .mockImplementationOnce(() => createMockProcess())
      .mockImplementationOnce(() => { throw new Error('spawn ENOENT'); });

    const manager = new SessionManager();
    await manager.startSession('msg-1', 'Hello 1', '', 'test-token', 'user-1', ['/mock/repo'], 'k1');
    await manager.startSession('msg-2', 'Hello 2', '', 'test-token', 'user-1', ['/mock/repo'], 'k2');
    const queued = manager.startSession('msg-3', 'Hello 3', '', 'test-token', 'user-1', ['/mock/repo'], 'k3');
    await new Promise((resolve) => setTimeout(resolve, 10));

    first.emit('close', 0);

    await expect(queued).rejects.toThrow('spawn ENOENT');
  });

  it('tells the MCP server which verification run it serves, and nothing when there is none', async () => {
    mockSpawn.mockReturnValue(createMockProcess());
    const manager = new SessionManager();

    await manager.startSession('msg-1', 'Hi', '', 'tok', 'user-1', ['/mock/repo'], 'key-1');
    const chatArgs = mockSpawn.mock.calls[0][1] as string[];
    const chatMcp = JSON.parse(readFileSync(chatArgs[chatArgs.indexOf('--mcp-config') + 1], 'utf8'));
    expect(chatMcp.mcpServers.knowledge.env.VERIFICATION_RUN_ID).toBe('');

    await manager.startSession('msg-2', 'Hi', '', 'tok', 'user-1', ['/mock/repo'], 'verify-run-9', 'run-9');
    const verifyArgs = mockSpawn.mock.calls[1][1] as string[];
    const verifyMcp = JSON.parse(readFileSync(verifyArgs[verifyArgs.indexOf('--mcp-config') + 1], 'utf8'));
    expect(verifyMcp.mcpServers.knowledge.env.VERIFICATION_RUN_ID).toBe('run-9');
  });

  it('cleans up process on close', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const manager = new SessionManager();
    await manager.startSession('msg-1', 'Hello', '', 'test-token', 'user-1', ['/mock/repo']);

    expect(manager.activeCount).toBe(1);

    proc.emit('close', 0);
    expect(manager.activeCount).toBe(0);
  });
});
