import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import type { ChildProcess } from 'child_process';
import { attachClaudeProcess } from '@/lib/claude-process-stream';

function fakeProcess() {
  const proc = new EventEmitter() as unknown as ChildProcess & { stdout: PassThrough; stderr: PassThrough };
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  return proc;
}

describe('attachClaudeProcess tool inputs', () => {
  it('emits onToolUseInput with the complete input from assistant events only', async () => {
    const proc = fakeProcess();
    const inputs: Array<[string, Record<string, unknown>]> = [];
    const names: string[] = [];
    attachClaudeProcess(proc, {
      onToolUse: (n) => names.push(n),
      onToolUseInput: (n, i) => inputs.push([n, i]),
    });

    const partial = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'Read', input: {} } },
    });
    const full = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Looking…' },
          { type: 'tool_use', name: 'Read', input: { file_path: '/repos/1/a.php' } },
        ],
      },
    });
    proc.stdout.write(partial + '\n' + full + '\n');
    proc.stdout.end();
    await new Promise((r) => setImmediate(r));

    expect(names).toEqual(['Read', 'Read']);
    expect(inputs).toEqual([['Read', { file_path: '/repos/1/a.php' }]]);
  });

  it('skips tool_use blocks whose input is missing or not an object', async () => {
    const proc = fakeProcess();
    const inputs: unknown[] = [];
    attachClaudeProcess(proc, { onToolUseInput: (_n, i) => inputs.push(i) });
    proc.stdout.write(
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Glob' }] } }) + '\n',
    );
    proc.stdout.end();
    await new Promise((r) => setImmediate(r));
    expect(inputs).toEqual([]);
  });
});

describe('attachClaudeProcess MCP server status', () => {
  it('calls onMcpServerStatus when the init system event lists MCP server states', () => {
    const onMcpServerStatus = jest.fn();
    const proc = fakeProcess();
    attachClaudeProcess(proc, { onMcpServerStatus });

    proc.stdout.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          type: 'system',
          subtype: 'init',
          session_id: 'sess-1',
          mcp_servers: [
            { name: 'knowledge', status: 'connected' },
            { name: 'sentry', status: 'failed' },
          ],
        }) + '\n',
      ),
    );

    expect(onMcpServerStatus).toHaveBeenCalledWith([
      { name: 'knowledge', status: 'connected' },
      { name: 'sentry', status: 'failed' },
    ]);
  });

  it('does not call onMcpServerStatus for a system event with no mcp_servers field', () => {
    const onMcpServerStatus = jest.fn();
    const proc = fakeProcess();
    attachClaudeProcess(proc, { onMcpServerStatus });

    proc.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'system', session_id: 'sess-1' }) + '\n'));

    expect(onMcpServerStatus).not.toHaveBeenCalled();
  });
});
