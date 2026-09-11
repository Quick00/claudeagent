import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

jest.mock('child_process', () => ({ spawn: jest.fn() }));
jest.mock('fs', () => ({ mkdirSync: jest.fn() }));
jest.mock('@/lib/config', () => ({
  config: {
    maxConcurrentSessions: 5,
    claudeMaxTurns: 25,
    claudeDisallowedTools: ['Bash', 'Task'],
  },
}));

import { SessionManager } from '@/lib/session-manager';

const mockSpawn = spawn as jest.Mock;

function fakeChild() {
  const proc = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; pid: number };
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.pid = 123;
  return proc;
}

describe('SessionManager spawn arguments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSpawn.mockImplementation(() => fakeChild());
  });

  it('passes --disallowedTools and the provenance key to the MCP server on start', () => {
    const sm = new SessionManager();
    sm.startSession('r1', 'hi', 'sys', 'tok', 'u1', ['/repos/1'], 'msg-1');
    const args = mockSpawn.mock.calls[0][1] as string[];
    const idx = args.indexOf('--disallowedTools');
    expect(idx).toBeGreaterThan(-1);
    expect(args.slice(idx + 1, idx + 3)).toEqual(['Bash', 'Task']);
    const mcp = JSON.parse(args[args.indexOf('--mcp-config') + 1]);
    expect(mcp.mcpServers.knowledge.env.PROVENANCE_KEY).toBe('msg-1');
    expect(mcp.mcpServers.knowledge.env.REPOSITORY_ID).toBeUndefined();
  });

  it('does the same on resume', () => {
    const sm = new SessionManager();
    sm.resumeSession('r1', 'sess', 'hi', 'tok', 'u1', 'msg-2');
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain('--disallowedTools');
    const mcp = JSON.parse(args[args.indexOf('--mcp-config') + 1]);
    expect(mcp.mcpServers.knowledge.env.PROVENANCE_KEY).toBe('msg-2');
  });
});
