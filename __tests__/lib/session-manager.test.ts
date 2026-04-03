import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

// Mock child_process
const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

// Mock config
jest.mock('@/lib/config', () => ({
  config: {
    repoPath: '/mock/eventinsight',
    maxConcurrentSessions: 2,
    sessionIdleTimeoutMs: 1000,
    claudeMaxTurns: 25,
    systemPrompt: 'Test prompt',
  },
}));

function createMockProcess(): ChildProcess {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: jest.fn(), end: jest.fn() };
  proc.kill = jest.fn();
  proc.pid = Math.floor(Math.random() * 10000);
  return proc;
}

describe('SessionManager', () => {
  let SessionManager: any;

  beforeEach(async () => {
    jest.resetModules();
    mockSpawn.mockReset();
    const mod = await import('@/lib/session-manager');
    SessionManager = mod.SessionManager;
  });

  it('spawns a new claude process for a new conversation', () => {
    mockSpawn.mockReturnValue(createMockProcess());

    const manager = new SessionManager();
    const proc = manager.startSession('msg-1', 'Hello');

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const args = mockSpawn.mock.calls[0];
    expect(args[0]).toBe('claude');
    expect(args[1]).toContain('--print');
    expect(args[1]).toContain('--output-format');
    expect(args[1]).toContain('stream-json');
  });

  it('uses --resume for existing sessions', () => {
    mockSpawn.mockReturnValue(createMockProcess());

    const manager = new SessionManager();
    const proc = manager.resumeSession('msg-2', 'session-abc', 'Follow up');

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

    // Start 2 sessions (the max)
    manager.startSession('msg-1', 'Hello 1');
    manager.startSession('msg-2', 'Hello 2');

    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(manager.queueSize).toBe(0);

    // Third should be queued
    const queued = manager.startSession('msg-3', 'Hello 3');
    expect(manager.queueSize).toBe(1);

    // Complete first process — queued one should start
    procs[0].emit('close', 0);

    // Allow microtask queue to flush
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockSpawn).toHaveBeenCalledTimes(3);
    expect(manager.queueSize).toBe(0);
  });

  it('cleans up process on close', () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const manager = new SessionManager();
    manager.startSession('msg-1', 'Hello');

    expect(manager.activeCount).toBe(1);

    proc.emit('close', 0);
    expect(manager.activeCount).toBe(0);
  });
});
