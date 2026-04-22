import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { sessionManager } from '@/lib/session-manager';
import { config } from '@/lib/config';
import { stripSourceReferences } from '@/lib/sanitize-response';
import { decrypt } from '@/lib/crypto';
import { ChildProcess } from 'child_process';
import { findRelevantEntries, KnowledgeEntryResult } from '@/lib/embeddings';
import path from 'path';
import { attachClaudeProcess, createSseResponse } from '@/lib/claude-process-stream';
import { NextResponse } from 'next/server';

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
    return NextResponse.json({ error: tokenResult.error }, { status: tokenResult.status });
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

  // --- Collect all active repo directories (before any DB writes) ---
  const activeRepos = await prisma.repository.findMany({
    where: { active: true },
    select: { name: true, description: true, localPath: true, lastPulledAt: true },
  });
  const repoPaths = activeRepos.map(r => r.localPath);

  if (repoPaths.length === 0 && config.repoPath) {
    repoPaths.push(config.repoPath);
  }

  if (repoPaths.length === 0) {
    return NextResponse.json({ error: 'No repositories configured. Please ask an admin to add a repository.' }, { status: 503 });
  }

  let conversation: { id: string; claudeSessionId: string | null; repositoryId: string | null };
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
      const imageLines = attachments.map((a) => {
        const absolutePath = path.resolve(a.storagePath);
        const sizeKB = (a.size / 1024).toFixed(1);
        return `- ${absolutePath} (${a.filename}, ${sizeKB}KB)`;
      });
      cliMessage += `\n\n---\nThe user attached ${attachments.length} image(s). Read each one with the Read tool before responding:\n${imageLines.join('\n')}`;
    }
  }

  let repoContext = '';
  if (activeRepos.length > 0) {
    repoContext = '\n\nYou have access to the following codebases:';
    for (const repo of activeRepos) {
      repoContext += `\n- "${repo.name}": ${repo.description}`;
      if (repo.lastPulledAt) {
        repoContext += ` (last synced: ${repo.lastPulledAt.toISOString()})`;
      }
    }
    repoContext += `\nIf a knowledge entry contradicts what you see in the current code, trust the code — the entry may be outdated. Use save_knowledge to save the corrected version — the system will update the page automatically.`;
  }

  let knowledgeEntries: KnowledgeEntryResult[] = [];
  try {
    knowledgeEntries = await findRelevantEntries(message, 10);
  } catch (err) {
    console.error('[chat] Failed to fetch relevant entries, falling back to all:', (err as Error).message);
    const fallback = await prisma.knowledgeEntry.findMany({
      orderBy: { createdAt: 'asc' },
    });
    knowledgeEntries = fallback.map((e) => ({ ...e, repositoryName: null }));
  }

  let systemPrompt = config.systemPrompt;

  if (knowledgeEntries.length > 0) {
    let knowledgeBlock = '\n\n---\nKNOWLEDGE BASE (use this to give better answers):\n';

    for (const entry of knowledgeEntries) {
      const heading = entry.subject || entry.category.replace('_', ' ');
      const source = entry.repositoryName ? ` [from: ${entry.repositoryName}]` : '';
      knowledgeBlock += `\n## ${heading}${source}\n${entry.content}\n`;
    }

    systemPrompt += knowledgeBlock;
  }

  systemPrompt += repoContext;

  systemPrompt += `\n\n${config.knowledgeToolsPrompt}`;

  return createSseResponse((sink) => {
    // Send conversation ID immediately so the client can update the sidebar
    sink.send(JSON.stringify({ type: 'conversation_created', conversationId: conversation.id, title: message.slice(0, 100) }));

    // On resumed sessions the system prompt isn't re-sent, so Claude
    // drifts and starts including file paths / code references.  Prepend
    // a short reminder to each follow-up message.
    const effectiveMessage = conversation.claudeSessionId
      ? config.responseReminder + cliMessage
      : cliMessage;

    function attachProcess(proc: ChildProcess, retryCount: number) {
      let fullResponse = '';
      let lastSentLength = 0;
      let claudeSessionId: string | null = null;
      let authFailed = false;
      let retrying = false;

      attachClaudeProcess(proc, {
        logPrefix: '[chat]',
        onSessionId: (sid) => { claudeSessionId = sid; },
        onTextDelta: (delta) => {
          fullResponse += delta;
          const sanitized = stripSourceReferences(fullResponse);
          // If sanitization shortened already-sent text, reset so
          // subsequent clean text isn't permanently dropped.
          if (sanitized.length < lastSentLength) {
            lastSentLength = sanitized.length;
          }
          const newContent = sanitized.slice(lastSentLength);
          if (newContent) {
            sink.send(JSON.stringify({ type: 'text', content: newContent }));
            lastSentLength = sanitized.length;
          }
        },
        onToolUse: (tool) => {
          sink.send(JSON.stringify({ type: 'tool_use', tool }));
        },
        onAuthFailed: () => {
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
          sink.send(JSON.stringify({
            type: 'error',
            content: 'Your Claude account token is invalid or expired. Please re-link your Claude account in Settings.',
            errorType: 'claude_token_expired',
          }));
          sink.close();
        },
        onRateLimit: (rateLimitMessage) => {
          prisma.message.create({
            data: {
              conversationId: conversation.id,
              role: 'assistant',
              content: rateLimitMessage,
            },
          }).catch((err) => console.error('[chat] Failed to save rate-limit message:', err));
          sink.send(JSON.stringify({ type: 'text', content: rateLimitMessage }));
        },
        onResult: (event) => {
          if (event.is_error && event.subtype === 'error_during_execution' && retryCount < MAX_RETRIES) {
            console.log(`[chat] error_during_execution — retrying (attempt ${retryCount + 1}/${MAX_RETRIES})`);
            retrying = true;
            const retryRequestId = `${conversation.id}-retry-${Date.now()}`;
            const retryProcOrPromise = conversation.claudeSessionId
              ? sessionManager.resumeSession(retryRequestId, conversation.claudeSessionId, effectiveMessage, userClaudeToken, userId, conversation.repositoryId || undefined)
              : sessionManager.startSession(retryRequestId, effectiveMessage, systemPrompt, userClaudeToken, userId, repoPaths);

            if (retryProcOrPromise instanceof Promise) {
              retryProcOrPromise.then((retryProc) => attachProcess(retryProc, retryCount + 1)).catch((err) => {
                console.error('[chat] Failed to acquire retry process:', err.message);
                sink.send(JSON.stringify({
                  type: 'error',
                  content: 'Failed to retry Claude process. Please try again.',
                }));
                sink.close();
              });
            } else {
              attachProcess(retryProcOrPromise, retryCount + 1);
            }
            return true; // stop processing remaining lines in this chunk
          }
        },
        onClose: async (code) => {
          console.log(`[chat] Process closed (code=${code}, responseLength=${fullResponse.length}, sessionId=${claudeSessionId}, authFailed=${authFailed}, retrying=${retrying})`);
          if (authFailed) {
            sink.close();
            return;
          }
          if (retrying) {
            return;
          }
          if (fullResponse) {
            const finalSanitized = stripSourceReferences(fullResponse);

            // Flush any remaining sanitized text not yet streamed
            const remaining = finalSanitized.slice(lastSentLength);
            if (remaining) {
              sink.send(JSON.stringify({ type: 'text', content: remaining }));
            }

            await prisma.message.create({
              data: {
                conversationId: conversation.id,
                role: 'assistant',
                content: finalSanitized,
              },
            });

            if (claudeSessionId) {
              await prisma.conversation.update({
                where: { id: conversation.id },
                data: { claudeSessionId },
              });
            }
          }

          sink.send(JSON.stringify({ type: 'done', conversationId: conversation.id }));
          sink.close();
        },
        onProcessError: (err) => {
          console.error('[chat] Process error:', err.message);
          sink.send(JSON.stringify({
            type: 'error',
            content: 'Claude process encountered an error. Please try again.',
          }));
          sink.close();
        },
      });
    }

    const requestId = `${conversation.id}-${Date.now()}`;
    console.log(`[chat] Starting request (requestId=${requestId}, conversationId=${conversation.id}, resume=${!!conversation.claudeSessionId}, knowledgeEntries=${knowledgeEntries.length})`);

    const procOrPromise = conversation.claudeSessionId
      ? sessionManager.resumeSession(requestId, conversation.claudeSessionId, effectiveMessage, userClaudeToken, userId, conversation.repositoryId || undefined)
      : sessionManager.startSession(requestId, effectiveMessage, systemPrompt, userClaudeToken, userId, repoPaths);

    if (procOrPromise instanceof Promise) {
      procOrPromise.then((proc) => {
        console.log(`[chat] Process acquired (pid=${proc.pid})`);
        attachProcess(proc, 0);
      }).catch((err) => {
        console.error('[chat] Failed to acquire process:', err.message);
        sink.send(JSON.stringify({
          type: 'error',
          content: 'Failed to start Claude process. Please try again.',
        }));
        sink.close();
      });
    } else {
      console.log(`[chat] Process acquired (pid=${procOrPromise.pid})`);
      attachProcess(procOrPromise, 0);
    }
  });
}
