import { spawn } from 'child_process';
import path from 'path';

const SERVER = path.join(__dirname, '..', 'knowledge-server.mjs');

type ToolResult = { tools?: Array<{ name: string }>; isError?: boolean; content?: Array<{ text: string }> };

/** Sends JSON-RPC requests to a fresh server process and collects one reply per request. */
async function rpc(env: Record<string, string>, requests: Array<{ method: string; params?: unknown }>) {
  const proc = spawn(process.execPath, [SERVER], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
  const replies: Array<{ id: number; result: ToolResult }> = [];
  let buffer = '';
  const done = new Promise<void>((resolve) => {
    proc.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        replies.push(JSON.parse(buffer.slice(0, nl)));
        buffer = buffer.slice(nl + 1);
        if (replies.length === requests.length) resolve();
      }
    });
  });
  requests.forEach((r, i) => proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i + 1, ...r }) + '\n'));
  await done;
  proc.kill();
  return replies.sort((a, b) => a.id - b.id).map((r) => r.result);
}

const toolNames = (result: ToolResult) => (result.tools ?? []).map((t) => t.name);

describe('knowledge-server create_file', () => {
  it('is offered in a chat session', async () => {
    const [list] = await rpc({ VERIFICATION_RUN_ID: '' }, [{ method: 'tools/list' }]);
    expect(toolNames(list)).toContain('create_file');
  });

  it('is withheld and refused during a verification run', async () => {
    const [list, call] = await rpc({ VERIFICATION_RUN_ID: 'run-1' }, [
      { method: 'tools/list' },
      { method: 'tools/call', params: { name: 'create_file', arguments: { format: 'pdf', filename: 'x', content: 'hi' } } },
    ]);
    expect(toolNames(list)).not.toContain('create_file');
    expect(call.isError).toBe(true);
  });

  it('reports an unreachable app as a tool error rather than crashing', async () => {
    const [call] = await rpc({ VERIFICATION_RUN_ID: '', KNOWLEDGE_FILES_URL: 'http://127.0.0.1:9/nope' }, [
      { method: 'tools/call', params: { name: 'create_file', arguments: { format: 'pdf', filename: 'x', content: 'hi' } } },
    ]);
    expect(call.isError).toBe(true);
    expect(call.content?.[0].text).toMatch(/file/i);
  });
});
