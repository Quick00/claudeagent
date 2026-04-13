import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { sessionManager } from '@/lib/session-manager';
import { decrypt } from '@/lib/crypto';
import { ChildProcess } from 'child_process';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
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

  const ownerClaudeToken = decrypt(conversation.user.claudeToken);
  const conversationId = conversation.id;
  const ownerUserId = conversation.user.id;
  const repositoryId = conversation.repositoryId ?? undefined;
  const sessionId = conversation.claudeSessionId;

  // Persist admin message + flip PENDING flags atomically
  await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'user',
        content,
        sentByAdminId: currentUser.id,
        seenByOwner: false,
      },
    }),
    prisma.flag.updateMany({
      where: { conversationId: conversation.id, status: 'PENDING' },
      data: {
        status: 'RESPONDED',
        adminId: currentUser.id,
        respondedAt: new Date(),
      },
    }),
  ]);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const safeSend = (data: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          closed = true;
        }
      };
      const safeClose = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      };

      function attachProcess(proc: ChildProcess) {
        let fullResponse = '';
        let newSessionId: string | null = null;

        proc.stdout!.on('data', (chunk: Buffer) => {
          const lines = chunk.toString().split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              const event = JSON.parse(line);

              if (event.type === 'system' && event.session_id) {
                newSessionId = event.session_id;
              }

              if (event.type === 'stream_event' && event.event?.type === 'content_block_delta') {
                const delta = event.event.delta;
                if (delta?.type === 'text_delta' && delta.text) {
                  fullResponse += delta.text;
                  safeSend(JSON.stringify({ type: 'text', content: delta.text }));
                }
              }

              if (event.type === 'assistant' && event.message?.content) {
                for (const block of event.message.content) {
                  if (block.type === 'tool_use') {
                    safeSend(JSON.stringify({ type: 'tool_use', tool: block.name || 'unknown' }));
                  }
                }
              }

              if (event.type === 'result' && event.session_id) {
                newSessionId = event.session_id;
              }
            } catch {
              // non-JSON line, skip
            }
          }
        });

        proc.stderr!.on('data', (chunk: Buffer) => {
          console.error('[admin-chat] stderr:', chunk.toString());
        });

        proc.on('close', async () => {
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
          safeSend(JSON.stringify({ type: 'done', conversationId }));
          safeClose();
        });

        proc.on('error', (err) => {
          console.error('[admin-chat] process error:', err.message);
          safeSend(JSON.stringify({
            type: 'error',
            content: 'Claude process encountered an error. Please try again.',
          }));
          safeClose();
        });
      }

      const requestId = `admin-${conversation.id}-${Date.now()}`;
      const procOrPromise = sessionManager.resumeSession(
        requestId,
        sessionId,
        content,
        ownerClaudeToken,
        ownerUserId,
        repositoryId,
      );

      if (procOrPromise instanceof Promise) {
        procOrPromise.then(attachProcess).catch((err) => {
          console.error('[admin-chat] failed to acquire process:', err.message);
          safeSend(JSON.stringify({
            type: 'error',
            content: 'Failed to start Claude process. Please try again.',
          }));
          safeClose();
        });
      } else {
        attachProcess(procOrPromise);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
