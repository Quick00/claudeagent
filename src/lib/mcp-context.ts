import { prisma } from '@/lib/prisma';

export interface LinkedServerSummary {
  name: string;
  description: string | null;
}

// Not `getUsableConnectionsForSession`: that one decrypts and refreshes tokens, which the session spawn does anyway.
export async function getLinkedServersForPrompt(userId: string): Promise<LinkedServerSummary[]> {
  const connections = await prisma.mcpServerConnection.findMany({
    where: { userId, status: 'CONNECTED', mcpServer: { enabled: true } },
    select: { mcpServer: { select: { name: true, description: true } } },
    orderBy: { mcpServer: { name: 'asc' } },
  });

  return connections.map((c) => ({ name: c.mcpServer.name, description: c.mcpServer.description }));
}

export function formatMcpServersBlock(servers: LinkedServerSummary[]): string {
  if (servers.length === 0) return '';

  const lines = servers.map((s) => (s.description ? `- ${s.name} — ${s.description}` : `- ${s.name}`));

  return `
---
CONNECTED SOURCES:
Alongside the codebase and the knowledge base, this account is connected to the sources below. Their tools are named after the source they belong to.
${lines.join('\n')}
Reach for a source when the question is about what that source holds — a ticket, a procedure, an error report — instead of answering from the code alone. Read the code when the question is about how the product behaves.
If a source returns nothing or fails, say plainly what you could not look up. Never guess the contents of a ticket, a page or a report.`;
}

// `resumeSession` passes no `--system-prompt`, so after turn one this line is all the model has.
export function formatMcpServersReminder(servers: LinkedServerSummary[]): string {
  if (servers.length === 0) return '';

  const names = servers.map((s) => s.name).join(', ');
  return `[CONNECTED SOURCES: ${names}. Reach for one when the question is about what it holds; say what you could not look up if a call fails.]\n\n`;
}
