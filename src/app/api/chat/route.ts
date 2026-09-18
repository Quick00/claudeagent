import { requireApprovedUser } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { sessionManager } from '@/lib/session-manager';
import { config } from '@/lib/config';
import { stripSourceReferences } from '@/lib/sanitize-response';
import { decrypt } from '@/lib/crypto';
import { ChildProcess } from 'child_process';
import { retrieveKnowledge, type LabelledEntry } from '@/lib/knowledge-context';
import { buildSystemPrompt, buildCliMessage } from '@/lib/chat-prompt';
import { getLinkedServersForPrompt } from '@/lib/mcp-context';
import { provenanceCollector } from '@/lib/provenance-collector';
import { getKnowledgeIgnoreLists } from '@/lib/settings';
import path from 'path';
import { attachClaudeProcess, createSseResponse } from '@/lib/claude-process-stream';
import { recordMcpServerStatus } from '@/lib/mcp-connections';
import { NextResponse } from 'next/server';

const MAX_RETRIES = 2;

/**
 * One stretch of answer text, to be rendered and stored as its own bubble.
 * `sentLength` is how much of the sanitized text has already gone out as
 * `text` frames, so a delta only ever streams the tail.
 */
type Segment = { raw: string; sentLength: number };

export async function POST(request: Request) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return auth.response;
  const user = auth.user;
  const userId = user.id;

  if (!user.claudeToken) {
    return NextResponse.json({ error: 'claude_account_not_linked' }, { status: 403 });
  }
  const userClaudeToken = decrypt(user.claudeToken);

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
    select: { name: true, description: true, localPath: true, lastPulledAt: true, gitlabProjectId: true },
  });
  const repoPaths = activeRepos.map(r => r.localPath);

  if (repoPaths.length === 0 && config.repoPath) {
    repoPaths.push(config.repoPath);
  }

  if (repoPaths.length === 0) {
    return NextResponse.json({ error: 'No repositories configured. Please ask an admin to add a repository.' }, { status: 503 });
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

  provenanceCollector.start(
    userMessage.id,
    activeRepos.map((r) => ({ gitlabProjectId: r.gitlabProjectId, localPath: r.localPath })),
    await getKnowledgeIgnoreLists(),
  );

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
    repoContext += `\nKnowledge marked VERIFIED matches the current code. Knowledge marked POSSIBLY OUTDATED describes code that has changed since it was saved: read the code before repeating it, and if it is wrong, save the corrected version with save_knowledge (the system merges it into the right page). Pinned business rules take precedence over code: if the code differs from a pinned rule, say so.`;
  }

  let knowledge: LabelledEntry[] = [];
  try {
    knowledge = await retrieveKnowledge(message, 10);
  } catch (err) {
    console.error('[chat] Knowledge retrieval failed, continuing without knowledge:', (err as Error).message);
  }

  const isResumed = Boolean(conversation.claudeSessionId);
  const linkedServers = await getLinkedServersForPrompt(userId);
  const systemPrompt = buildSystemPrompt({ isResumed, knowledge, repoContext, linkedServers });

  return createSseResponse((sink) => {
    // Send conversation ID immediately so the client can update the sidebar
    sink.send(JSON.stringify({ type: 'conversation_created', conversationId: conversation.id, title: message.slice(0, 100) }));

    // On resumed sessions the system prompt isn't re-sent, so Claude
    // drifts and starts including file paths / code references.  Prepend
    // a short reminder to each follow-up message.
    const effectiveMessage = buildCliMessage({ isResumed, knowledge, linkedServers, message: cliMessage });

    // One notice per server per turn: a retry re-runs both the startup drop
    // check and the mid-session init event, and a server that failed on the
    // first attempt is often reported again on the second.
    const noticedServers = new Set<string>();
    function notifyServerDrop(name: string, message: string) {
      if (noticedServers.has(name)) return;
      noticedServers.add(name);
      sink.send(JSON.stringify({ type: 'mcp_server_notice', server: name, message }));
    }

    function attachProcess(proc: ChildProcess, retryCount: number) {
      // The answer as bubbles: one segment per stretch of text between tool calls.
      // `current` is the one being written; a tool call closes it and opens another.
      // Locals of `attachProcess`, so a retry starts from a clean slate.
      const segments: Segment[] = [{ raw: '', sentLength: 0 }];
      let current = segments[0];
      let claudeSessionId: string | null = null;
      let authFailed = false;
      let retrying = false;

      /**
       * End the bubble being written and open the next: flush whatever of it
       * has not gone out yet, then announce the break.
       *
       * A no-op on a segment with no text, which is what keeps a tool fired
       * before any prose from opening an empty leading bubble — and what makes
       * it safe to call twice, as `attachClaudeProcess` does for every tool
       * (once from `content_block_start`, once from the complete `assistant`
       * event; see the ['Read', 'Read'] assertion in
       * claude-process-stream.test.ts). Emptiness is judged on the *sanitized*
       * text: a segment that was nothing but a stripped file path is no bubble.
       */
      function breakSegment() {
        const closing = stripSourceReferences(current.raw);
        if (!closing.trim()) return;
        const remaining = closing.slice(current.sentLength);
        if (remaining) {
          sink.send(JSON.stringify({ type: 'text', content: remaining }));
        }
        current.sentLength = closing.length;
        sink.send(JSON.stringify({ type: 'text_break' }));
        current = { raw: '', sentLength: 0 };
        segments.push(current);
      }

      attachClaudeProcess(proc, {
        logPrefix: '[chat]',
        onSessionId: (sid) => { claudeSessionId = sid; },
        onTextDelta: (delta) => {
          current.raw += delta;
          const sanitized = stripSourceReferences(current.raw);
          // If sanitization shortened already-sent text, reset so
          // subsequent clean text isn't permanently dropped.
          if (sanitized.length < current.sentLength) {
            current.sentLength = sanitized.length;
          }
          const newContent = sanitized.slice(current.sentLength);
          if (newContent) {
            sink.send(JSON.stringify({ type: 'text', content: newContent }));
            current.sentLength = sanitized.length;
          }
        },
        onToolUse: (tool) => {
          // Before the tool frame, not after: the break belongs to the text that
          // just ended, so the client closes that bubble and only then hangs the
          // tool label beneath it.
          breakSegment();
          sink.send(JSON.stringify({ type: 'tool_use', tool }));
        },
        onToolUseInput: (tool, input) => {
          provenanceCollector.recordToolUse(userMessage.id, tool, input);
        },
        onMcpServerStatus: (servers) => {
          for (const server of servers) {
            if (server.name === 'knowledge') continue; // never surfaced to the user
            // Every status is recorded, not only the bad ones: a healthy
            // report is what clears the note an earlier failure left in
            // Settings (see `recordMcpServerStatus`).
            recordMcpServerStatus(userId, server.name, server.status).catch((err) => {
              console.error(`[chat] Failed to record MCP server status for "${server.name}":`, err.message);
            });
            if (server.status === 'failed' || server.status === 'needs-auth') {
              console.error(`[chat] MCP server "${server.name}" reported status "${server.status}" (userId=${userId})`);
              notifyServerDrop(server.name, `${server.name} is unavailable this turn — reconnect it in Settings.`);
            }
          }
        },
        onAuthFailed: () => {
          console.error('[chat] Authentication failed — invalid Claude token');
          authFailed = true;
          // Drop the partial answer: the error row below is what this turn becomes.
          segments.length = 1;
          segments[0] = { raw: '', sentLength: 0 };
          current = segments[0];
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
          provenanceCollector.end(userMessage.id);
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
          // The notice is its own row above, so give it a bubble of its own
          // live too. It never enters `current.raw` — hence no new segment here,
          // and no second copy of it from `onClose`.
          breakSegment();
          sink.send(JSON.stringify({ type: 'text', content: rateLimitMessage }));
          sink.send(JSON.stringify({ type: 'text_break' }));
        },
        onResult: (event) => {
          if (event.is_error && event.subtype === 'error_during_execution' && retryCount < MAX_RETRIES) {
            console.log(`[chat] error_during_execution — retrying (attempt ${retryCount + 1}/${MAX_RETRIES})`);
            retrying = true;
            const retryRequestId = `${conversation.id}-retry-${Date.now()}`;
            const retryProcOrPromise = conversation.claudeSessionId
              ? sessionManager.resumeSession(retryRequestId, conversation.claudeSessionId, effectiveMessage, userClaudeToken, userId, userMessage.id)
              : sessionManager.startSession(retryRequestId, effectiveMessage, systemPrompt, userClaudeToken, userId, repoPaths, userMessage.id);

            retryProcOrPromise.then((retryProc) => {
              for (const dropped of sessionManager.takeDroppedServers(retryRequestId)) {
                notifyServerDrop(dropped.name, `${dropped.name} is unavailable this turn (${dropped.reason}).`);
              }
              attachProcess(retryProc, retryCount + 1);
            }).catch((err) => {
              console.error('[chat] Failed to acquire retry process:', err.message);
              // The config was built before acquisition failed, so this
              // request has an entry waiting to be read exactly once.
              sessionManager.takeDroppedServers(retryRequestId);
              sink.send(JSON.stringify({
                type: 'error',
                content: 'Failed to retry Claude process. Please try again.',
              }));
              // No process attached, so no terminal handler will end the collection started above.
              provenanceCollector.end(userMessage.id);
              sink.close();
            });
            return true; // stop processing remaining lines in this chunk
          }
        },
        onClose: async (code) => {
          const responseLength = segments.reduce((n, s) => n + s.raw.length, 0);
          console.log(`[chat] Process closed (code=${code}, responseLength=${responseLength}, segments=${segments.length}, sessionId=${claudeSessionId}, authFailed=${authFailed}, retrying=${retrying})`);
          if (authFailed) {
            sink.close();
            return;
          }
          if (retrying) {
            return;
          }
          provenanceCollector.end(userMessage.id);

          // Flush the tail of the open segment. Closed ones were already flushed
          // at the tool call that closed them.
          const finalCurrent = stripSourceReferences(current.raw);
          if (finalCurrent.length > current.sentLength) {
            sink.send(JSON.stringify({ type: 'text', content: finalCurrent.slice(current.sentLength) }));
            current.sentLength = finalCurrent.length;
          }

          // A boundary lands exactly where trailing newlines pile up, so trim —
          // otherwise a bubble ends in a blank line. Empty segments (a tool
          // before any text, a tool after the last) never become rows.
          const contents = segments
            .map((segment) => stripSourceReferences(segment.raw).trim())
            .filter((content) => content.length > 0);

          if (contents.length > 0) {
            // `Message.createdAt` is TIMESTAMP(3) — millisecond precision. Rows
            // written back to back tie at the same millisecond, and the
            // `orderBy createdAt asc` in GET /api/conversations/[id] is then free
            // to return them in any order, scrambling the bubbles on reload.
            // Hence explicit, strictly increasing timestamps: sequential creates
            // would not be enough. The `max` guards against clock skew between
            // the app and the DB sorting an answer before its question.
            const base = Math.max(Date.now(), userMessage.createdAt.getTime() + 1);
            await prisma.message.createMany({
              data: contents.map((content, i) => ({
                conversationId: conversation.id,
                role: 'assistant' as const,
                content,
                createdAt: new Date(base + i),
              })),
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
          provenanceCollector.end(userMessage.id);
          sink.close();
        },
      });
    }

    const requestId = `${conversation.id}-${Date.now()}`;
    console.log(`[chat] Starting request (requestId=${requestId}, conversationId=${conversation.id}, resume=${!!conversation.claudeSessionId}, knowledgeEntries=${knowledge.length})`);

    const procOrPromise = conversation.claudeSessionId
      ? sessionManager.resumeSession(requestId, conversation.claudeSessionId, effectiveMessage, userClaudeToken, userId, userMessage.id)
      : sessionManager.startSession(requestId, effectiveMessage, systemPrompt, userClaudeToken, userId, repoPaths, userMessage.id);

    procOrPromise.then((proc) => {
      console.log(`[chat] Process acquired (pid=${proc.pid})`);
      for (const dropped of sessionManager.takeDroppedServers(requestId)) {
        notifyServerDrop(dropped.name, `${dropped.name} is unavailable this turn (${dropped.reason}).`);
      }
      attachProcess(proc, 0);
    }).catch((err) => {
      console.error('[chat] Failed to acquire process:', err.message);
      // The config was built before acquisition failed, so this request has
      // an entry waiting to be read exactly once.
      sessionManager.takeDroppedServers(requestId);
      sink.send(JSON.stringify({
        type: 'error',
        content: 'Failed to start Claude process. Please try again.',
      }));
      // No process attached, so no terminal handler will end the collection started above.
      provenanceCollector.end(userMessage.id);
      sink.close();
    });
  });
}
