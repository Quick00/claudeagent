import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { sessionManager } from '@/lib/session-manager';

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

  // Spawn or resume Claude CLI
  const requestId = `${conversation.id}-${Date.now()}`;
  console.log(`[chat] Starting request (requestId=${requestId}, conversationId=${conversation.id}, resume=${!!conversation.claudeSessionId})`);

  const procOrPromise = conversation.claudeSessionId
    ? sessionManager.resumeSession(requestId, conversation.claudeSessionId, message)
    : sessionManager.startSession(requestId, message);

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

            // Forward assistant text — the stream-json format nests text in message.content
            if (event.type === 'assistant' && event.message?.content) {
              for (const block of event.message.content) {
                if (block.type === 'text' && block.text) {
                  fullResponse += block.text;
                  const sseData = JSON.stringify({ type: 'text', content: block.text });
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
