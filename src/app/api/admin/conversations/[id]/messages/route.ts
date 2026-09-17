import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { sessionManager } from '@/lib/session-manager';
import { decrypt } from '@/lib/crypto';
import { attachClaudeProcess, createSseResponse } from '@/lib/claude-process-stream';
import { provenanceCollector } from '@/lib/provenance-collector';
import { getKnowledgeIgnoreLists } from '@/lib/settings';
import type { ChildProcess } from 'child_process';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new Response('Unauthorized', { status: 401 });
  }

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  if (!currentUser || currentUser.role !== 'admin') {
    return new Response('Forbidden', { status: 403 });
  }

  const { id } = await params;
  const { content } = (await request.json()) as { content?: string };

  if (!content || !content.trim()) {
    return new Response('content is required', { status: 400 });
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, claudeToken: true } },
    },
  });

  if (!conversation) {
    return new Response('Conversation not found', { status: 404 });
  }

  if (conversation.userId === currentUser.id) {
    return new Response('Use /api/chat for your own conversations', { status: 400 });
  }

  if (!conversation.user.claudeToken) {
    return new Response('Owner has not linked a Claude account', { status: 409 });
  }

  if (!conversation.claudeSessionId) {
    return new Response('Conversation has not been started by the owner yet', { status: 409 });
  }

  const conversationId = conversation.id;
  const ownerUserId = conversation.user.id;
  const ownerClaudeToken = decrypt(conversation.user.claudeToken);
  const sessionId = conversation.claudeSessionId;

  // Persist admin message + flip PENDING flags atomically so the admin's
  // intent is recorded even if the Claude stream later fails.
  const [adminMessage] = await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId,
        role: 'user',
        content,
        sentByAdminId: currentUser.id,
        seenByOwner: false,
      },
    }),
    prisma.flag.updateMany({
      where: { conversationId, status: 'PENDING' },
      data: {
        status: 'RESPONDED',
        adminId: currentUser.id,
        respondedAt: new Date(),
      },
    }),
  ]);

  const activeRepos = await prisma.repository.findMany({
    where: { active: true },
    select: { gitlabProjectId: true, localPath: true },
  });
  provenanceCollector.start(adminMessage.id, activeRepos, await getKnowledgeIgnoreLists());

  return createSseResponse((sink) => {
    let fullResponse = '';
    let newSessionId: string | null = null;

    function attach(proc: ChildProcess) {
      attachClaudeProcess(proc, {
        logPrefix: '[admin-chat]',
        onSessionId: (sid) => { newSessionId = sid; },
        onTextDelta: (delta) => {
          fullResponse += delta;
          sink.send(JSON.stringify({ type: 'text', content: delta }));
        },
        onToolUse: (tool) => {
          sink.send(JSON.stringify({ type: 'tool_use', tool }));
        },
        onToolUseInput: (tool, input) => {
          provenanceCollector.recordToolUse(adminMessage.id, tool, input);
        },
        onClose: async () => {
          provenanceCollector.end(adminMessage.id);
          if (fullResponse) {
            await prisma.message.create({
              data: {
                conversationId,
                role: 'assistant',
                content: fullResponse,
                seenByOwner: false,
              },
            });
            if (newSessionId && newSessionId !== sessionId) {
              await prisma.conversation.update({
                where: { id: conversationId },
                data: { claudeSessionId: newSessionId },
              });
            }
          }
          sink.send(JSON.stringify({ type: 'done', conversationId }));
          sink.close();
        },
        onProcessError: (err) => {
          console.error('[admin-chat] process error:', err.message);
          sink.send(JSON.stringify({
            type: 'error',
            content: 'Claude process encountered an error. Please try again.',
          }));
          provenanceCollector.end(adminMessage.id);
          sink.close();
        },
      });
    }

    const requestId = `admin-${conversationId}-${Date.now()}`;
    /**
     * This admin view has no in-chat notice for a dropped server, but the
     * session manager keys them per request and hands them out exactly once,
     * so an unread entry sits in its map for the lifetime of the process.
     */
    const drainDroppedServers = () => {
      const dropped = sessionManager.takeDroppedServers(requestId);
      if (dropped.length > 0) {
        console.warn(`[admin-chat] MCP servers unavailable this turn: ${dropped.map((d) => d.name).join(', ')}`);
      }
    };

    const procOrPromise = sessionManager.resumeSession(
      requestId,
      sessionId,
      content,
      ownerClaudeToken,
      ownerUserId,
      adminMessage.id,
    );

    if (procOrPromise instanceof Promise) {
      procOrPromise.then(attach).catch((err) => {
        console.error('[admin-chat] failed to acquire process:', err.message);
        sink.send(JSON.stringify({
          type: 'error',
          content: 'Failed to start Claude process. Please try again.',
        }));
        sink.close();
      }).finally(drainDroppedServers);
    } else {
      attach(procOrPromise);
      drainDroppedServers();
    }
  });
}
