/**
 * Dev tool: talk to a linked MCP server directly over HTTP, bypassing both
 * the Claude CLI and the LLM. Runs the same two calls the CLI makes on
 * connect (`initialize`, then `tools/list`) and flags anything shaped
 * wrong, without needing a chat turn or an agent to notice the failure.
 *
 * Usage:
 *   npx tsx scripts/debug-mcp.ts <server-name> [user-email]
 *
 * If user-email is omitted, the first CONNECTED connection for that
 * server is used. Never prints the access token.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createDecipheriv } from 'crypto';

function decrypt(ciphertext: string): string {
  const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY ?? '', 'hex');
  const buf = Buffer.from(ciphertext, 'base64');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(buf.length - 16);
  const encrypted = buf.subarray(12, buf.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

type JsonValue = unknown;

async function callMcp(url: string, token: string, body: JsonValue): Promise<{ status: number; contentType: string | null; json: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  });
  const contentType = res.headers.get('content-type');
  const text = await res.text();
  if (!text) return { status: res.status, contentType, json: null };
  if (contentType?.includes('text/event-stream')) {
    const dataLine = text.split('\n').find((line) => line.startsWith('data:'));
    return { status: res.status, contentType, json: dataLine ? JSON.parse(dataLine.slice(5).trim()) : null };
  }
  return { status: res.status, contentType, json: JSON.parse(text) };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Mirrors the shape checks the Claude CLI's own zod schema enforces on tools/list. */
function checkTool(tool: unknown, index: number): string[] {
  const problems: string[] = [];
  const prefix = `tools.${index}`;
  if (!isPlainObject(tool)) return [`${prefix}: expected object`];
  if (typeof tool.name !== 'string') problems.push(`${prefix}.name: expected string`);
  if (tool.description !== undefined && typeof tool.description !== 'string') {
    problems.push(`${prefix}.description: expected string`);
  }
  const schema = tool.inputSchema;
  if (!isPlainObject(schema)) {
    problems.push(`${prefix}.inputSchema: expected object`);
    return problems;
  }
  if (schema.properties !== undefined) {
    if (!isPlainObject(schema.properties)) {
      problems.push(`${prefix}.inputSchema.properties: expected object`);
    } else {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        if (!isPlainObject(propSchema)) {
          problems.push(`${prefix}.inputSchema.properties.${propName}: expected object, got ${JSON.stringify(propSchema)}`);
        }
      }
    }
  }
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || schema.required.some((r) => typeof r !== 'string')) {
      problems.push(`${prefix}.inputSchema.required: expected string[]`);
    }
  }
  return problems;
}

async function main() {
  const [serverName, userEmail] = process.argv.slice(2);
  if (!serverName) {
    console.error('Usage: npx ts-node scripts/debug-mcp.ts <server-name> [user-email]');
    process.exit(1);
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
  const prisma = new PrismaClient({ adapter });

  try {
    const server = await prisma.mcpServer.findUnique({ where: { name: serverName } });
    if (!server) {
      const names = (await prisma.mcpServer.findMany({ select: { name: true } })).map((s) => s.name);
      console.error(`No McpServer named "${serverName}". Known servers: ${names.join(', ') || '(none)'}`);
      process.exit(1);
    }

    const connection = await prisma.mcpServerConnection.findFirst({
      where: { mcpServerId: server.id, ...(userEmail ? { user: { email: userEmail } } : {}) },
      include: { user: { select: { email: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    if (!connection) {
      console.error(`No connection found for server "${serverName}"${userEmail ? ` and user ${userEmail}` : ''}.`);
      process.exit(1);
    }

    console.log(`server:     ${server.name} (${server.transport}) ${server.serverUrl}`);
    if (server.resource !== server.serverUrl) {
      console.log(`resource:   ${server.resource}  (differs from serverUrl — informational only)`);
    }
    console.log(`user:       ${connection.user.email}`);
    console.log(`status:     ${connection.status}${connection.lastError ? ` (${connection.lastError})` : ''}`);
    console.log(`expiresAt:  ${connection.expiresAt?.toISOString() ?? '(none)'}${connection.expiresAt && connection.expiresAt < new Date() ? '  ** EXPIRED **' : ''}`);

    if (connection.status !== 'CONNECTED') {
      console.log('\nConnection is not CONNECTED — reconnect via Settings before debugging further.');
      return;
    }
    if (!connection.accessToken) {
      console.log('\nNo access token stored on this connection.');
      return;
    }
    if (connection.expiresAt && connection.expiresAt < new Date()) {
      console.log('\nToken is expired. This script does not refresh — reconnect via Settings, or retry a chat turn (which refreshes automatically) and rerun this script.');
      return;
    }

    const token = decrypt(connection.accessToken);

    console.log('\n--- initialize ---');
    const init = await callMcp(server.serverUrl, token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'debug-mcp', version: '0' } },
    });
    console.log(`status: ${init.status}`);
    console.log(JSON.stringify(init.json, null, 2));

    const initResult = isPlainObject(init.json) && isPlainObject(init.json.result) ? init.json.result : null;
    const capsTools = initResult && isPlainObject(initResult.capabilities) ? initResult.capabilities.tools : undefined;
    if (capsTools !== undefined && !isPlainObject(capsTools)) {
      console.log(`\n** capabilities.tools should be an object (e.g. {}), got: ${JSON.stringify(capsTools)} **`);
    }
    if (init.status < 200 || init.status >= 300 || !initResult) {
      console.log('\ninitialize did not succeed — stopping before tools/list.');
      return;
    }

    console.log('\n--- tools/list ---');
    const list = await callMcp(server.serverUrl, token, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    console.log(`status: ${list.status}`);
    console.log(JSON.stringify(list.json, null, 2));

    const tools = isPlainObject(list.json) && isPlainObject(list.json.result) && Array.isArray(list.json.result.tools)
      ? list.json.result.tools
      : null;
    if (!tools) {
      console.log('\nNo result.tools array in the response.');
      return;
    }

    console.log(`\n--- shape check (${tools.length} tools) ---`);
    let anyProblem = false;
    tools.forEach((tool, index) => {
      const problems = checkTool(tool, index);
      const name = isPlainObject(tool) && typeof tool.name === 'string' ? tool.name : `(index ${index})`;
      if (problems.length === 0) {
        console.log(`  OK    ${name}`);
      } else {
        anyProblem = true;
        console.log(`  FAIL  ${name}`);
        for (const p of problems) console.log(`          ${p}`);
      }
    });
    if (!anyProblem) console.log('\nAll tool schemas look valid — the CLI should connect fine.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('debug-mcp failed:', err);
  process.exit(1);
});
