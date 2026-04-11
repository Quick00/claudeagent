import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { sessionManager } from '@/lib/session-manager';
import { config } from '@/lib/config';
import { decrypt } from '@/lib/crypto';
import { ChildProcess } from 'child_process';
import { findRelevantEntries } from '@/lib/embeddings';
import path from 'path';
import { routeQuestion } from '@/lib/repo-router';

const MAX_RETRIES = 2;

async function getUserClaudeToken(userEmail: string): Promise<{ token: string } | { error: string; status: number }> {
  const user = await prisma.user.findUnique({
    where: { email: userEmail },
    select: { claudeToken: true },
  });

  if (!user?.claudeToken) {
    return { error: 'claude_account_not_linked', status: 403 };
  }

  return { token: decrypt(user.claudeToken) };
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new Response('Unauthorized', { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  if (!user) {
    return new Response('User not found', { status: 404 });
  }
  const userId = user.id;

  const tokenResult = await getUserClaudeToken(session.user.email);
  if ('error' in tokenResult) {
    return Response.json({ error: tokenResult.error }, { status: tokenResult.status });
  }
  const userClaudeToken = tokenResult.token;

  const body = await request.json();
  const { conversationId, message, attachmentIds } = body as {
    conversationId: string | null;
    message: string;
    attachmentIds?: string[];
  };

  if (!message?.trim()) {
    return new Response('Message is required', { status: 400 });
  }

  let conversation: { id: string; claudeSessionId: string | null };
  if (conversationId) {
    const existing = await prisma.conversation.findFirst({
      where: { id: conversationId, userId: userId },
    });
    if (!existing) {
      return new Response('Conversation not found', { status: 404 });
    }
    conversation = existing;
  } else {
    conversation = await prisma.conversation.create({
      data: {
        userId: userId,
        title: message.slice(0, 100),
      },
    });
  }

  const userMessage = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: 'user',
      content: message,
    },
  });

  // Link attachments to the user message and build image references for CLI
  let cliMessage = message;
  if (attachmentIds && attachmentIds.length > 0) {
    const attachments = await prisma.attachment.findMany({
      where: { id: { in: attachmentIds.slice(0, config.maxFilesPerMessage) } },
    });

    if (attachments.length > 0) {
      // Link attachments to the message
      await prisma.attachment.updateMany({
        where: { id: { in: attachments.map((a) => a.id) } },
        data: { messageId: userMessage.id },
      });

      // Append absolute image paths to the message for Claude CLI
      // (CLI runs with cwd=repoPath, so relative paths would resolve incorrectly)
      const imageLines = attachments.map((a) => {
        const absolutePath = path.resolve(a.storagePath);
        const sizeKB = (a.size / 1024).toFixed(1);
        return `- ${absolutePath} (${a.filename}, ${sizeKB}KB)`;
      });
      cliMessage += `\n\n---\nThe user attached ${attachments.length} image(s). Read each one with the Read tool before responding:\n${imageLines.join('\n')}`;
    }
  }

  // --- Repo routing ---
  let repoPath = config.repoPath; // fallback to legacy single-repo
  let repositoryId: string | null = null;

  if (conversation.claudeSessionId && conversationId) {
    // Resuming: use the repo already linked to this conversation
    const existingConv = await prisma.conversation.findUnique({
      where: { id: conversation.id },
      select: { repositoryId: true, repository: { select: { localPath: true, name: true, description: true, lastPulledAt: true } } },
    });
    if (existingConv?.repository) {
      repoPath = existingConv.repository.localPath;
      repositoryId = existingConv.repositoryId;
    }
  } else {
    // New conversation: route to the best repo
    const activeRepos = await prisma.repository.findMany({
      where: { active: true },
      select: { id: true, name: true, description: true, localPath: true, lastPulledAt: true },
    });

    if (activeRepos.length > 0) {
      try {
        const chosenId = await routeQuestion(message, activeRepos);
        const chosen = activeRepos.find((r) => r.id === chosenId);
        if (chosen) {
          repoPath = chosen.localPath;
          repositoryId = chosen.id;

          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { repositoryId: chosen.id },
          });
        }
      } catch (err) {
        console.error('[chat] Routing failed, using fallback:', (err as Error).message);
      }
    }
  }

  // Get repo info for system prompt context
  let repoContext = '';
  if (repositoryId) {
    const repo = await prisma.repository.findUnique({
      where: { id: repositoryId },
      select: { name: true, description: true, lastPulledAt: true },
    });
    if (repo) {
      repoContext = `\n\nYou are answering questions about the "${repo.name}" codebase: ${repo.description}`;
      if (repo.lastPulledAt) {
        repoContext += `\nCode last synced: ${repo.lastPulledAt.toISOString()}`;
      }
      repoContext += `\nIf a knowledge entry contradicts what you see in the current code, trust the code — the entry may be outdated. Use save_knowledge to save an updated correction.`;
    }
  }

  let knowledgeEntries: { id: string; category: string; content: string; tags: string; source: string | null; createdAt: Date; repositoryName?: string | null }[] = [];
  try {
    knowledgeEntries = await findRelevantEntries(message, 10);
  } catch (err) {
    console.error('[chat] Failed to fetch relevant entries, falling back to all:', (err as Error).message);
    knowledgeEntries = await prisma.knowledgeEntry.findMany({
      orderBy: { createdAt: 'asc' },
    });
  }

  let systemPrompt = config.systemPrompt;

  if (knowledgeEntries.length > 0) {
    const grouped: Record<string, { content: string; repositoryName: string | null }[]> = {};
    for (const entry of knowledgeEntries) {
      if (!grouped[entry.category]) grouped[entry.category] = [];
      grouped[entry.category].push({ content: entry.content, repositoryName: entry.repositoryName || null });
    }

    const categoryLabels: Record<string, string> = {
      correction: 'Important corrections (these override what you find in code)',
      terminology: 'Product terminology',
      product_insight: 'Product knowledge',
      process: 'Business processes',
    };

    let knowledgeBlock = '\n\n---\nKNOWLEDGE BASE (use this to give better answers):\n';
    for (const [cat, entries] of Object.entries(grouped)) {
      knowledgeBlock += `\n## ${categoryLabels[cat] || cat}\n`;
      for (const entry of entries) {
        const source = entry.repositoryName ? `[from: ${entry.repositoryName}]` : '[global]';
        knowledgeBlock += `- ${source} ${entry.content}\n`;
      }
    }
    systemPrompt += knowledgeBlock;
  }

  systemPrompt += repoContext;

  systemPrompt += `\n\n${config.knowledgeToolsPrompt}`;

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
        try {
          controller.close();
        } catch {
          // Already closed
        }
      };

      // Send conversation ID immediately so the client can update the sidebar
      safeSend(JSON.stringify({ type: 'conversation_created', conversationId: conversation.id, title: message.slice(0, 100) }));

      function attachProcess(proc: ChildProcess, retryCount: number) {
        let fullResponse = '';
        let claudeSessionId: string | null = null;
        let authFailed = false;
        let retrying = false;

        proc.stdout!.on('data', (chunk: Buffer) => {
          const raw = chunk.toString();
          console.log(`[chat] stdout chunk (${raw.length} bytes):`, raw.slice(0, 200));

          const lines = raw.split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              const event = JSON.parse(line);
              console.log(`[chat] Parsed event: type=${event.type}, subtype=${event.subtype || 'none'}`);

              if (event.type === 'system' && event.session_id) {
                claudeSessionId = event.session_id;
                console.log(`[chat] Got session ID from system event: ${claudeSessionId}`);
              }

              if (event.type === 'stream_event' && event.event?.type === 'content_block_delta') {
                const delta = event.event.delta;
                if (delta?.type === 'text_delta' && delta.text) {
                  fullResponse += delta.text;
                  const sseData = JSON.stringify({ type: 'text', content: delta.text });
                  safeSend(sseData);
                }
              }

              if (event.type === 'assistant' && event.error === 'authentication_failed') {
                console.error('[chat] Authentication failed — invalid Claude token');
                authFailed = true;
                fullResponse = '';
                prisma.message.create({
                  data: {
                    conversationId: conversation.id,
                    role: 'assistant',
                    content: 'Your Claude account token is invalid or expired. Please re-link your Claude account in Settings.',
                  },
                }).catch((err) => console.error('[chat] Failed to save auth error message:', err));
                const sseData = JSON.stringify({
                  type: 'error',
                  content: 'Your Claude account token is invalid or expired. Please re-link your Claude account in Settings.',
                  errorType: 'claude_token_expired',
                });
                safeSend(sseData);
                safeClose();
              }

              if (event.type === 'assistant' && event.message?.content) {
                for (const block of event.message.content) {
                  if (block.type === 'tool_use') {
                    const toolName = block.name || 'unknown';
                    const sseData = JSON.stringify({ type: 'tool_use', tool: toolName });
                    safeSend(sseData);
                  }
                }
              }

              if (
                  event.type === 'assistant' &&
                  event.error === 'rate_limit' &&
                  event.message?.content
              ) {
                prisma.message.create({
                  data: {
                    conversationId: conversation.id,
                    role: 'assistant',
                    content: event.message.content[0].text,
                  },
                }).catch((err) => console.error('[chat] Failed to save auth error message:', err));

                const sseData = JSON.stringify({ type: 'text', content: event.message.content[0].text });
                safeSend(sseData);
              }

              if (event.type === 'result') {
                if (event.session_id) {
                  claudeSessionId = event.session_id;
                  console.log(`[chat] Got session ID from result event: ${claudeSessionId}`);
                }

                if (event.is_error && event.subtype === 'error_during_execution' && retryCount < MAX_RETRIES) {
                  console.log(`[chat] error_during_execution — retrying (attempt ${retryCount + 1}/${MAX_RETRIES})`);
                  retrying = true;
                  const retryRequestId = `${conversation.id}-retry-${Date.now()}`;
                  const retryProcOrPromise = conversation.claudeSessionId
                    ? sessionManager.resumeSession(retryRequestId, conversation.claudeSessionId, cliMessage, userClaudeToken, userId)
                    : sessionManager.startSession(retryRequestId, cliMessage, systemPrompt, userClaudeToken, userId, repoPath, repositoryId || undefined);

                  if (retryProcOrPromise instanceof Promise) {
                    retryProcOrPromise.then((retryProc) => attachProcess(retryProc, retryCount + 1)).catch((err) => {
                      console.error('[chat] Failed to acquire retry process:', err.message);
                      const errorData = JSON.stringify({
                        type: 'error',
                        content: 'Failed to retry Claude process. Please try again.',
                      });
                      safeSend(errorData);
                      safeClose();
                    });
                  } else {
                    attachProcess(retryProcOrPromise, retryCount + 1);
                  }
                  return;
                }

                console.log(`[chat] Result event received, response length: ${fullResponse.length}`);
              }
            } catch {
              console.log(`[chat] Non-JSON line: ${line.slice(0, 100)}`);
            }
          }
        });

        proc.stderr!.on('data', (chunk: Buffer) => {
          console.error('[chat] stderr:', chunk.toString());
        });

        proc.on('close', async (code) => {
          console.log(`[chat] Process closed (code=${code}, responseLength=${fullResponse.length}, sessionId=${claudeSessionId}, authFailed=${authFailed}, retrying=${retrying})`);
          if (authFailed) {
            safeClose();
            return;
          }
          if (retrying) {
            return;
          }
          if (fullResponse) {
            await prisma.message.create({
              data: {
                conversationId: conversation.id,
                role: 'assistant',
                content: fullResponse,
              },
            });

            if (claudeSessionId) {
              await prisma.conversation.update({
                where: { id: conversation.id },
                data: { claudeSessionId },
              });
            }
          }

          const doneData = JSON.stringify({
            type: 'done',
            conversationId: conversation.id,
          });
          safeSend(doneData);
          safeClose();
        });

        proc.on('error', (err) => {
          console.error(`[chat] Process error:`, err.message);
          const errorData = JSON.stringify({
            type: 'error',
            content: 'Claude process encountered an error. Please try again.',
          });
          safeSend(errorData);
          safeClose();
        });
      }

      const requestId = `${conversation.id}-${Date.now()}`;
      console.log(`[chat] Starting request (requestId=${requestId}, conversationId=${conversation.id}, resume=${!!conversation.claudeSessionId}, knowledgeEntries=${knowledgeEntries.length})`);

      const procOrPromise = conversation.claudeSessionId
        ? sessionManager.resumeSession(requestId, conversation.claudeSessionId, cliMessage, userClaudeToken, userId)
        : sessionManager.startSession(requestId, cliMessage, systemPrompt, userClaudeToken, userId, repoPath, repositoryId || undefined);

      if (procOrPromise instanceof Promise) {
        procOrPromise.then((proc) => {
          console.log(`[chat] Process acquired (pid=${proc.pid})`);
          attachProcess(proc, 0);
        }).catch((err) => {
          console.error('[chat] Failed to acquire process:', err.message);
          const errorData = JSON.stringify({
            type: 'error',
            content: 'Failed to start Claude process. Please try again.',
          });
          safeSend(errorData);
          safeClose();
        });
      } else {
        console.log(`[chat] Process acquired (pid=${procOrPromise.pid})`);
        attachProcess(procOrPromise, 0);
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
