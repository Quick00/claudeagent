import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { sessionManager } from '@/lib/session-manager';
import { config } from '@/lib/config';
import { decrypt } from '@/lib/crypto';
import { ChildProcess } from 'child_process';

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

  const tokenResult = await getUserClaudeToken(session.user.email);
  if ('error' in tokenResult) {
    return Response.json({ error: tokenResult.error }, { status: tokenResult.status });
  }
  const userClaudeToken = tokenResult.token;

  const body = await request.json();
  const { conversationId, message } = body as {
    conversationId: string | null;
    message: string;
  };

  if (!message?.trim()) {
    return new Response('Message is required', { status: 400 });
  }

  let conversation: { id: string; claudeSessionId: string | null };
  if (conversationId) {
    const existing = await prisma.conversation.findFirst({
      where: { id: conversationId, userId: user.id },
    });
    if (!existing) {
      return new Response('Conversation not found', { status: 404 });
    }
    conversation = existing;
  } else {
    conversation = await prisma.conversation.create({
      data: {
        userId: user.id,
        title: message.slice(0, 100),
      },
    });
  }

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: 'user',
      content: message,
    },
  });

  const knowledgeEntries = await prisma.knowledgeEntry.findMany({
    orderBy: { createdAt: 'asc' },
  });

  let systemPrompt = config.systemPrompt;

  if (knowledgeEntries.length > 0) {
    const grouped: Record<string, string[]> = {};
    for (const entry of knowledgeEntries) {
      if (!grouped[entry.category]) grouped[entry.category] = [];
      grouped[entry.category].push(entry.content);
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
        knowledgeBlock += `- ${entry}\n`;
      }
    }
    systemPrompt += knowledgeBlock;
  }

  systemPrompt += `\n\n---
MEMORY SYSTEM — MANDATORY:
You have a "save_knowledge" tool. You MUST use it after EVERY answer where you investigated the codebase.

RULE: If you read any files or searched the codebase to answer a question, you MUST call save_knowledge at least once before finishing your response. This is not optional. The knowledge base is how the team builds shared understanding — every investigation adds value.

What to save (one call per distinct insight):
- How a feature works (e.g. "Badge printing supports 5 custom badge types per event, each tied to a registration category")
- Business rules you discovered (e.g. "HubSpot data takes priority over Summit data when both exist for the same contact")
- What product terms mean (e.g. "A 'coupling' in the platform means a connection to an external system like HubSpot or Summit")
- Corrections from the user (if they tell you something was wrong, save the correct version immediately)
- Developer insights (use category "developer"): architecture patterns, how components connect, gotchas, technical decisions. IMPORTANT: also save the code flow — which files are involved and in what order, so you don't need to re-read them next time. E.g. "HubSpot import flow: cronjobs/OgzHubspotImport.php → HubspotImportHelper → HubspotApiHelper. Uses per-event mapping configs from Helpers/Mappings/ to map HubSpot fields to registration fields."

Do NOT save:
- Things already listed in the KNOWLEDGE BASE section above
- Generic facts ("the platform manages events")

Keep entries concise (1-2 sentences). Always include 1-3 lowercase tags.`;

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
                    ? sessionManager.resumeSession(retryRequestId, conversation.claudeSessionId, message, userClaudeToken)
                    : sessionManager.startSession(retryRequestId, message, systemPrompt, userClaudeToken);

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
        ? sessionManager.resumeSession(requestId, conversation.claudeSessionId, message, userClaudeToken)
        : sessionManager.startSession(requestId, message, systemPrompt, userClaudeToken);

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
