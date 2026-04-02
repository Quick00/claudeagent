import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { sessionManager } from '@/lib/session-manager';
import { config } from '@/lib/config';

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

  const body = await request.json();
  const { conversationId, message } = body as {
    conversationId: string | null;
    message: string;
  };

  if (!message?.trim()) {
    return new Response('Message is required', { status: 400 });
  }

  // Get or create conversation
  let conversation;
  if (conversationId) {
    conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId: user.id },
    });
    if (!conversation) {
      return new Response('Conversation not found', { status: 404 });
    }
  } else {
    conversation = await prisma.conversation.create({
      data: {
        userId: user.id,
        title: message.slice(0, 100),
      },
    });
  }

  // Save user message
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: 'user',
      content: message,
    },
  });

  // Build system prompt with knowledge context
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

  // Add memory instructions
  const knowledgeApiUrl = `${process.env.NEXTAUTH_URL}/api/knowledge`;
  const knowledgeApiSecret = process.env.KNOWLEDGE_API_SECRET;

  systemPrompt += `\n\n---
MEMORY SYSTEM:
When you discover something important while answering a question — a correction to a common misunderstanding, a useful product insight, how a feature actually works, or important terminology — save it so future questions benefit from this knowledge.

To save knowledge, use the Bash tool to run:
curl -s -X POST "${knowledgeApiUrl}" -H "Content-Type: application/json" -H "Authorization: Bearer ${knowledgeApiSecret}" -d '{"category":"<CATEGORY>","content":"<WHAT YOU LEARNED>","tags":"<comma-separated topics>"}'

Categories: "correction" (wrong assumptions corrected), "terminology" (what product terms mean), "product_insight" (how features work), "process" (business workflows).

Tags: short topic keywords that describe what this knowledge relates to (e.g. "badges,printing" or "registration,hubspot,import"). Use lowercase, keep tags to 1-2 words each. Reuse existing tags when possible.

Rules:
- Only save genuinely useful, reusable knowledge — not conversation-specific details.
- Keep entries concise (1-2 sentences).
- Always include 1-3 relevant tags so the knowledge map stays connected.
- Don't save things that are obvious from the codebase structure.
- DO save things that required deep investigation or that surprised you.
- DO save corrections when a user tells you your answer was wrong.`;

  // Spawn or resume Claude CLI
  const requestId = `${conversation.id}-${Date.now()}`;
  console.log(`[chat] Starting request (requestId=${requestId}, conversationId=${conversation.id}, resume=${!!conversation.claudeSessionId}, knowledgeEntries=${knowledgeEntries.length})`);

  const procOrPromise = conversation.claudeSessionId
    ? sessionManager.resumeSession(requestId, conversation.claudeSessionId, message)
    : sessionManager.startSession(requestId, message, systemPrompt);

  const proc = procOrPromise instanceof Promise ? await procOrPromise : procOrPromise;
  console.log(`[chat] Process acquired (pid=${proc.pid})`);

  // Stream response as SSE
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let fullResponse = '';
      let claudeSessionId: string | null = null;

      proc.stdout!.on('data', (chunk: Buffer) => {
        const raw = chunk.toString();
        console.log(`[chat] stdout chunk (${raw.length} bytes):`, raw.slice(0, 200));

        const lines = raw.split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            console.log(`[chat] Parsed event: type=${event.type}, subtype=${event.subtype || 'none'}`);

            // Extract session ID from the first result event
            if (event.type === 'system' && event.session_id) {
              claudeSessionId = event.session_id;
              console.log(`[chat] Got session ID from system event: ${claudeSessionId}`);
            }

            // Forward assistant content — text and tool use progress
            if (event.type === 'assistant' && event.message?.content) {
              for (const block of event.message.content) {
                if (block.type === 'text' && block.text) {
                  fullResponse += block.text;
                  const sseData = JSON.stringify({ type: 'text', content: block.text });
                  controller.enqueue(encoder.encode(`data: ${sseData}\n\n`));
                }
                if (block.type === 'tool_use') {
                  const toolName = block.name || 'unknown';
                  const sseData = JSON.stringify({ type: 'tool_use', tool: toolName });
                  controller.enqueue(encoder.encode(`data: ${sseData}\n\n`));
                }
              }
            }

            // Handle result event (final)
            if (event.type === 'result') {
              if (event.session_id) {
                claudeSessionId = event.session_id;
                console.log(`[chat] Got session ID from result event: ${claudeSessionId}`);
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
        console.log(`[chat] Process closed (code=${code}, responseLength=${fullResponse.length}, sessionId=${claudeSessionId})`);
        // Save assistant response
        if (fullResponse) {
          await prisma.message.create({
            data: {
              conversationId: conversation.id,
              role: 'assistant',
              content: fullResponse,
            },
          });
        }

        // Save Claude session ID for future --resume calls
        if (claudeSessionId) {
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { claudeSessionId },
          });
        }

        const doneData = JSON.stringify({
          type: 'done',
          conversationId: conversation.id,
        });
        controller.enqueue(encoder.encode(`data: ${doneData}\n\n`));
        controller.close();
      });

      proc.on('error', (err) => {
        console.error(`[chat] Process error:`, err.message);
        const errorData = JSON.stringify({
          type: 'error',
          content: 'Claude process encountered an error. Please try again.',
        });
        controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
        controller.close();
      });
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
