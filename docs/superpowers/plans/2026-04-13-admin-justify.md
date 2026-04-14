# Admin Justify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin post a message into another user's conversation, attributed to the admin, that goes to Claude using the conversation owner's Claude token. As a paired UX improvement, refactor the chat to interleave admin flag-responses chronologically with user/assistant messages.

**Architecture:** Extend `Message` with `sentByAdminId` (admin attribution) and `seenByOwner` (notification flag). Add a single new endpoint `POST /api/admin/conversations/[id]/messages` that mirrors the `/api/chat` SSE flow but loads the *owner's* Claude token and uses `sessionManager.resumeSession` (admin-send is restricted to conversations that already have a `claudeSessionId`). Reuse the existing `MessageBubble role="admin"` rendering. Refactor `ChatMessages` to merge messages and responded flags by timestamp instead of appending flags last. When admin posts on a flagged conversation, mark the PENDING flags RESPONDED in the same transaction.

**Tech Stack:** Next.js 16 App Router (TypeScript), Prisma 7 / PostgreSQL, NextAuth.js 4, React 19, Jest 30, Tailwind CSS 4. Reuse existing `lib/session-manager`, `lib/crypto.decrypt`, `lib/prisma`.

**Spec:** `docs/superpowers/specs/2026-04-13-admin-justify-design.md`

**Branch:** `feature/admin-justify` (already created)

---

## File Structure

**Migrations (created):**
- `prisma/migrations/<timestamp>_admin_sent_messages/migration.sql` — adds `Message.sentByAdminId`, `Message.seenByOwner`, FK to `User`, index.

**Schema (modified):**
- `prisma/schema.prisma` — extends `Message`, adds back-relation on `User`.

**API (created):**
- `src/app/api/admin/conversations/[id]/messages/route.ts` — `POST` admin-send endpoint with SSE.

**API (modified):**
- `src/app/api/conversations/[id]/route.ts` — extend `GET` response with `sentByAdmin`, `seenByOwner`, `isOwner`, `isAdmin`, `ownerHasClaudeToken`; mark unseen messages seen for the owner.

**Components (modified):**
- `src/components/ChatMessages.tsx` — merge messages + responded flags chronologically; render `sentByAdmin` messages with admin styling; show "new" dot on unseen admin messages.
- `src/components/ChatPage.tsx` — admin-send mode: header banner, hide flag button, swap endpoint, surface "owner not linked" disabled state.

**Pages (created):**
- `src/app/admin/users/[id]/conversations/page.tsx` — list a single user's conversations with deep-links into `/conversation/[id]`.

**API (created):**
- `src/app/api/admin/users/[id]/conversations/route.ts` — `GET` returns conversations for one user.

**Tests (created):**
- `__tests__/api/admin-conversation-messages.test.ts`
- `__tests__/api/conversations-get-extensions.test.ts`
- `__tests__/api/admin-user-conversations.test.ts`
- `__tests__/components/chat-messages-inline-flags.test.tsx`

---

## Task 1: Prisma Schema & Migration

**Files:**
- Modify: `prisma/schema.prisma:34-44, 10-22`
- Create: `prisma/migrations/<timestamp>_admin_sent_messages/migration.sql`

- [ ] **Step 1: Edit `prisma/schema.prisma` — extend `Message`**

Replace the `Message` model with:

```prisma
model Message {
  id             String       @id @default(uuid())
  conversationId String
  role           String       // "user" or "assistant"
  content        String
  createdAt      DateTime     @default(now())
  sentByAdminId  String?
  seenByOwner    Boolean      @default(true)
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  attachments    Attachment[]
  sentByAdmin    User?        @relation("AdminSentMessages", fields: [sentByAdminId], references: [id], onDelete: SetNull)

  @@index([sentByAdminId])
}
```

- [ ] **Step 2: Edit `prisma/schema.prisma` — add back-relation on `User`**

In the `User` model, add this line after `adminFlags`:

```prisma
  adminSentMessages    Message[] @relation("AdminSentMessages")
```

- [ ] **Step 3: Create migration**

Run: `npx prisma migrate dev --name admin_sent_messages`
Expected: A new migration directory under `prisma/migrations/` with `migration.sql` containing `ADD COLUMN "sentByAdminId"`, `ADD COLUMN "seenByOwner"`, foreign-key constraint to `User`, and `CREATE INDEX "Message_sentByAdminId_idx"`.
Expected: Prisma client regenerated.

- [ ] **Step 4: Verify migration file looks correct**

Run: `cat prisma/migrations/*admin_sent_messages*/migration.sql`
Expected output contains:
```
ALTER TABLE "Message" ADD COLUMN "sentByAdminId" TEXT;
ALTER TABLE "Message" ADD COLUMN "seenByOwner" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX "Message_sentByAdminId_idx" ON "Message"("sentByAdminId");
ALTER TABLE "Message" ADD CONSTRAINT "Message_sentByAdminId_fkey" FOREIGN KEY ("sentByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 5: Verify schema typechecks**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): add Message.sentByAdminId and seenByOwner for admin justify"
```

---

## Task 2: Extend `GET /api/conversations/[id]` Response

Add ownership context flags and per-message admin attribution; mark messages seen on owner read.

**Files:**
- Modify: `src/app/api/conversations/[id]/route.ts`
- Test: `__tests__/api/conversations-get-extensions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/conversations-get-extensions.test.ts`:

```typescript
import { GET } from '@/app/api/conversations/[id]/route';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

jest.mock('next-auth');
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    conversation: { findFirst: jest.fn() },
    message: { updateMany: jest.fn() },
  },
}));

const mockSession = getServerSession as jest.Mock;
const mockUser = prisma.user.findUnique as jest.Mock;
const mockConv = prisma.conversation.findFirst as jest.Mock;
const mockMsgUpdate = prisma.message.updateMany as jest.Mock;

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('GET /api/conversations/[id] — ownership extensions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMsgUpdate.mockResolvedValue({ count: 0 });
  });

  it('returns isOwner=true, isAdmin=false, ownerHasClaudeToken=true for the owner', async () => {
    mockSession.mockResolvedValue({ user: { email: 'owner@example.com' } });
    mockUser.mockResolvedValue({ id: 'u-owner', role: 'user', claudeToken: 'enc' });
    mockConv.mockResolvedValue({
      id: 'c1', userId: 'u-owner', title: 't', claudeSessionId: 's',
      messages: [], flags: [],
      user: { id: 'u-owner', name: 'Owner', claudeToken: 'enc' },
    });

    const res = await GET(new Request('http://x'), params('c1'));
    const body = await res.json();
    expect(body.isOwner).toBe(true);
    expect(body.isAdmin).toBe(false);
    expect(body.ownerHasClaudeToken).toBe(true);
  });

  it('returns isOwner=false, isAdmin=true for an admin viewing another user', async () => {
    mockSession.mockResolvedValue({ user: { email: 'admin@example.com' } });
    mockUser.mockResolvedValue({ id: 'u-admin', role: 'admin', claudeToken: null });
    mockConv.mockResolvedValue({
      id: 'c1', userId: 'u-other', title: 't', claudeSessionId: 's',
      messages: [], flags: [],
      user: { id: 'u-other', name: 'Other', claudeToken: 'enc' },
    });

    const res = await GET(new Request('http://x'), params('c1'));
    const body = await res.json();
    expect(body.isOwner).toBe(false);
    expect(body.isAdmin).toBe(true);
    expect(body.ownerHasClaudeToken).toBe(true);
  });

  it('marks all unseen messages as seen when owner reads', async () => {
    mockSession.mockResolvedValue({ user: { email: 'owner@example.com' } });
    mockUser.mockResolvedValue({ id: 'u-owner', role: 'user', claudeToken: 'enc' });
    mockConv.mockResolvedValue({
      id: 'c1', userId: 'u-owner', title: 't', claudeSessionId: 's',
      messages: [], flags: [],
      user: { id: 'u-owner', name: 'Owner', claudeToken: 'enc' },
    });

    await GET(new Request('http://x'), params('c1'));

    expect(mockMsgUpdate).toHaveBeenCalledWith({
      where: { conversationId: 'c1', seenByOwner: false },
      data: { seenByOwner: true },
    });
  });

  it('does NOT mark messages seen when admin reads someone else’s conversation', async () => {
    mockSession.mockResolvedValue({ user: { email: 'admin@example.com' } });
    mockUser.mockResolvedValue({ id: 'u-admin', role: 'admin', claudeToken: null });
    mockConv.mockResolvedValue({
      id: 'c1', userId: 'u-other', title: 't', claudeSessionId: 's',
      messages: [], flags: [],
      user: { id: 'u-other', name: 'Other', claudeToken: 'enc' },
    });

    await GET(new Request('http://x'), params('c1'));

    expect(mockMsgUpdate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api/conversations-get-extensions.test.ts`
Expected: All four tests FAIL (the route doesn't return the new fields and doesn't call `updateMany`).

- [ ] **Step 3: Modify `src/app/api/conversations/[id]/route.ts` — replace the entire `GET` function**

Replace the existing `GET` function (lines 7-52) with:

```typescript
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;

  const isAdmin = user.role === 'admin';
  const conversation = await prisma.conversation.findFirst({
    where: isAdmin ? { id } : { id, userId: user.id },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        include: {
          attachments: {
            select: { id: true, filename: true, mimeType: true, size: true },
          },
          sentByAdmin: {
            select: { id: true, name: true },
          },
        },
      },
      flags: {
        include: {
          admin: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
      user: {
        select: { id: true, name: true, claudeToken: true },
      },
    },
  });

  if (!conversation) {
    return new Response('Not found', { status: 404 });
  }

  const isOwner = conversation.userId === user.id;
  const ownerHasClaudeToken = !!conversation.user.claudeToken;

  // Mark unseen messages as seen for the owner only
  if (isOwner) {
    await prisma.message.updateMany({
      where: { conversationId: id, seenByOwner: false },
      data: { seenByOwner: true },
    });
  }

  // Strip the owner.claudeToken before returning (it's encrypted, but we never expose it)
  const { user: ownerUser, ...rest } = conversation;
  return NextResponse.json({
    ...rest,
    user: { id: ownerUser.id, name: ownerUser.name },
    isOwner,
    isAdmin,
    ownerHasClaudeToken,
  });
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/api/conversations-get-extensions.test.ts`
Expected: All four tests PASS.

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/conversations/\[id\]/route.ts __tests__/api/conversations-get-extensions.test.ts
git commit -m "feat(api): extend GET conversation with ownership + auto-mark-seen"
```

---

## Task 3: New `POST /api/admin/conversations/[id]/messages` Endpoint

The new endpoint streams Claude's reply via SSE using the owner's token; persists both turns; resolves PENDING flags atomically with the admin message insert.

**Files:**
- Create: `src/app/api/admin/conversations/[id]/messages/route.ts`
- Test: `__tests__/api/admin-conversation-messages.test.ts`

- [ ] **Step 1: Write the failing tests for non-streaming guard paths**

Create `__tests__/api/admin-conversation-messages.test.ts`:

```typescript
import { POST } from '@/app/api/admin/conversations/[id]/messages/route';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

jest.mock('next-auth');
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    conversation: { findUnique: jest.fn() },
    message: { create: jest.fn() },
    flag: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock('@/lib/session-manager', () => ({
  sessionManager: { resumeSession: jest.fn() },
}));
jest.mock('@/lib/crypto', () => ({ decrypt: (s: string) => `dec(${s})` }));

const mockSession = getServerSession as jest.Mock;
const mockUserFind = prisma.user.findUnique as jest.Mock;
const mockConvFind = prisma.conversation.findUnique as jest.Mock;

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (body: object) =>
  new Request('http://x', { method: 'POST', body: JSON.stringify(body) });

describe('POST /api/admin/conversations/[id]/messages — guards', () => {
  beforeEach(() => jest.clearAllMocks());

  it('401 when not authenticated', async () => {
    mockSession.mockResolvedValue(null);
    const res = await POST(req({ content: 'hi' }), params('c1'));
    expect(res.status).toBe(401);
  });

  it('403 when authenticated user is not admin', async () => {
    mockSession.mockResolvedValue({ user: { email: 'u@example.com' } });
    mockUserFind.mockResolvedValue({ id: 'u1', role: 'user' });
    const res = await POST(req({ content: 'hi' }), params('c1'));
    expect(res.status).toBe(403);
  });

  it('400 when admin is the conversation owner', async () => {
    mockSession.mockResolvedValue({ user: { email: 'a@example.com' } });
    mockUserFind.mockResolvedValue({ id: 'a1', role: 'admin' });
    mockConvFind.mockResolvedValue({
      id: 'c1', userId: 'a1', claudeSessionId: 's', repositoryId: null,
      user: { id: 'a1', claudeToken: 'enc' },
    });
    const res = await POST(req({ content: 'hi' }), params('c1'));
    expect(res.status).toBe(400);
  });

  it('404 when conversation does not exist', async () => {
    mockSession.mockResolvedValue({ user: { email: 'a@example.com' } });
    mockUserFind.mockResolvedValue({ id: 'a1', role: 'admin' });
    mockConvFind.mockResolvedValue(null);
    const res = await POST(req({ content: 'hi' }), params('c1'));
    expect(res.status).toBe(404);
  });

  it('409 when owner has no claudeToken', async () => {
    mockSession.mockResolvedValue({ user: { email: 'a@example.com' } });
    mockUserFind.mockResolvedValue({ id: 'a1', role: 'admin' });
    mockConvFind.mockResolvedValue({
      id: 'c1', userId: 'u-other', claudeSessionId: 's', repositoryId: null,
      user: { id: 'u-other', claudeToken: null },
    });
    const res = await POST(req({ content: 'hi' }), params('c1'));
    expect(res.status).toBe(409);
  });

  it('409 when conversation has no claudeSessionId', async () => {
    mockSession.mockResolvedValue({ user: { email: 'a@example.com' } });
    mockUserFind.mockResolvedValue({ id: 'a1', role: 'admin' });
    mockConvFind.mockResolvedValue({
      id: 'c1', userId: 'u-other', claudeSessionId: null, repositoryId: null,
      user: { id: 'u-other', claudeToken: 'enc' },
    });
    const res = await POST(req({ content: 'hi' }), params('c1'));
    expect(res.status).toBe(409);
  });

  it('400 when content is empty', async () => {
    mockSession.mockResolvedValue({ user: { email: 'a@example.com' } });
    mockUserFind.mockResolvedValue({ id: 'a1', role: 'admin' });
    mockConvFind.mockResolvedValue({
      id: 'c1', userId: 'u-other', claudeSessionId: 's', repositoryId: null,
      user: { id: 'u-other', claudeToken: 'enc' },
    });
    const res = await POST(req({ content: '   ' }), params('c1'));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (file doesn't exist yet)**

Run: `npx jest __tests__/api/admin-conversation-messages.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/admin/conversations/[id]/messages/route'".

- [ ] **Step 3: Create the route file**

Create `src/app/api/admin/conversations/[id]/messages/route.ts`:

```typescript
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
                conversationId: conversation.id,
                role: 'assistant',
                content: fullResponse,
                seenByOwner: false,
              },
            });
            if (newSessionId && newSessionId !== sessionId) {
              await prisma.conversation.update({
                where: { id: conversation.id },
                data: { claudeSessionId: newSessionId },
              });
            }
          }
          safeSend(JSON.stringify({ type: 'done', conversationId: conversation.id }));
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
```

- [ ] **Step 4: Run guard tests**

Run: `npx jest __tests__/api/admin-conversation-messages.test.ts`
Expected: All seven guard tests PASS.

- [ ] **Step 5: Add a happy-path test that verifies persistence + flag flip**

Append to `__tests__/api/admin-conversation-messages.test.ts`:

```typescript
import { sessionManager } from '@/lib/session-manager';
import { EventEmitter } from 'events';

const mockMsgCreate = prisma.message.create as jest.Mock;
const mockFlagUpdate = prisma.flag.updateMany as jest.Mock;
const mockTx = prisma.$transaction as jest.Mock;
const mockResume = sessionManager.resumeSession as jest.Mock;

describe('POST /api/admin/conversations/[id]/messages — happy path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMsgCreate.mockResolvedValue({});
    mockFlagUpdate.mockResolvedValue({ count: 1 });
    mockTx.mockImplementation((ops) => Promise.all(ops.map((p: Promise<unknown>) => p)));
  });

  it('persists admin message with sentByAdminId and seenByOwner=false, flips PENDING flags', async () => {
    mockSession.mockResolvedValue({ user: { email: 'a@example.com' } });
    mockUserFind.mockResolvedValue({ id: 'a1', role: 'admin' });
    mockConvFind.mockResolvedValue({
      id: 'c1', userId: 'u-other', claudeSessionId: 'sess-1', repositoryId: 'r1',
      user: { id: 'u-other', claudeToken: 'enc' },
    });

    const fakeProc = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    mockResume.mockReturnValue(fakeProc);

    const res = await POST(req({ content: 'Hello from admin' }), params('c1'));
    expect(res.status).toBe(200);

    // Inspect the transaction operations recorded
    expect(mockMsgCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        conversationId: 'c1',
        role: 'user',
        content: 'Hello from admin',
        sentByAdminId: 'a1',
        seenByOwner: false,
      }),
    }));
    expect(mockFlagUpdate).toHaveBeenCalledWith({
      where: { conversationId: 'c1', status: 'PENDING' },
      data: expect.objectContaining({
        status: 'RESPONDED',
        adminId: 'a1',
      }),
    });
    expect(mockResume).toHaveBeenCalledWith(
      expect.stringContaining('admin-c1-'),
      'sess-1',
      'Hello from admin',
      'dec(enc)',
      'u-other',
      'r1',
    );
  });
});
```

- [ ] **Step 6: Run all tests in the file**

Run: `npx jest __tests__/api/admin-conversation-messages.test.ts`
Expected: All eight tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/admin/conversations/\[id\]/messages/route.ts __tests__/api/admin-conversation-messages.test.ts
git commit -m "feat(api): admin can post messages in non-owned conversations"
```

---

## Task 4: ChatMessages — Inline Flag Responses + Admin Bubble Rendering

Merge `messages` and responded `flags` into one chronological timeline. Render messages with `sentByAdmin` using admin styling.

**Files:**
- Modify: `src/components/ChatMessages.tsx`
- Test: `__tests__/components/chat-messages-inline-flags.test.tsx`

- [ ] **Step 1: Add `jest-environment-jsdom` config note**

Check `jest.config.ts` for testEnvironment. If it is `node` (it is, per current config), individual component tests need `/** @jest-environment jsdom */` at the top. We will use this convention.

- [ ] **Step 2: Write the failing test**

Create `__tests__/components/chat-messages-inline-flags.test.tsx`:

```typescript
/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import ChatMessages from '@/components/ChatMessages';

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = jest.fn();

// Stub fetch so the recent-questions effect doesn't error
beforeAll(() => {
  global.fetch = jest.fn().mockResolvedValue({ json: async () => [] }) as unknown as typeof fetch;
});

describe('ChatMessages — inline flag responses + admin attribution', () => {
  it('interleaves a flag response between two messages by timestamp', () => {
    const messages = [
      { id: 'm1', role: 'user' as const, content: 'first', createdAt: '2026-04-13T10:00:00Z' },
      { id: 'm2', role: 'assistant' as const, content: 'reply', createdAt: '2026-04-13T10:02:00Z' },
    ];
    const flags = [
      {
        id: 'f1',
        status: 'RESPONDED',
        adminResponse: 'an admin note',
        respondedAt: '2026-04-13T10:01:00Z',
        admin: { name: 'Damian' },
      },
    ];

    const { container } = render(
      <ChatMessages
        messages={messages}
        streamingContent=""
        toolStatus={null}
        isLoading={false}
        onSendSuggestion={() => {}}
        flags={flags}
      />
    );

    const bubbles = container.querySelectorAll('[data-testid="message-bubble"]');
    // Order is: user "first", admin flag note, assistant "reply"
    expect(bubbles.length).toBe(3);
    expect(bubbles[0]).toHaveTextContent('first');
    expect(bubbles[1]).toHaveTextContent('an admin note');
    expect(bubbles[2]).toHaveTextContent('reply');
  });

  it('renders a message with sentByAdmin using admin bubble styling', () => {
    const messages = [
      {
        id: 'm1', role: 'user' as const, content: 'admin-sent text',
        createdAt: '2026-04-13T10:00:00Z',
        sentByAdmin: { id: 'a1', name: 'Damian' },
      },
    ];

    render(
      <ChatMessages
        messages={messages}
        streamingContent=""
        toolStatus={null}
        isLoading={false}
        onSendSuggestion={() => {}}
        flags={[]}
      />
    );

    expect(screen.getByText('admin-sent text')).toBeInTheDocument();
    expect(screen.getByText(/Admin — Damian/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Install jsdom + RTL deps if missing**

Run: `npm ls jest-environment-jsdom @testing-library/react @testing-library/jest-dom 2>&1 | head -20`
If any are missing, run:
```bash
npm install --save-dev jest-environment-jsdom @testing-library/react @testing-library/jest-dom
```
Expected: packages installed, `package.json` updated.

- [ ] **Step 4: Run test to verify it fails**

Run: `npx jest __tests__/components/chat-messages-inline-flags.test.tsx`
Expected: FAIL — current ChatMessages renders flags after all messages, doesn't honor `sentByAdmin`, and lacks `data-testid="message-bubble"`.

- [ ] **Step 5: Add `data-testid` to MessageBubble**

In `src/components/MessageBubble.tsx`, add `data-testid="message-bubble"` to the outer wrapping `<div>` of each of the three branches (user, admin, assistant). Example for the user branch:

```tsx
<div className="flex justify-end" data-testid="message-bubble">
```

Apply the same `data-testid` to the admin branch's outer `<div className="flex justify-start" ...>` and the assistant branch's outer `<div className="flex justify-start">`.

- [ ] **Step 6: Update `Message` interface in `ChatMessages.tsx` to include `sentByAdmin` and `createdAt`**

Replace the `Message` interface (around line 11-16) with:

```typescript
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  attachments?: Attachment[];
  sentByAdmin?: { id: string; name: string } | null;
  seenByOwner?: boolean;
}
```

- [ ] **Step 7: Replace the rendering block with merged timeline**

In `ChatMessages.tsx`, replace the block that currently renders messages then flags (the two `.map` blocks around lines 113-128) with:

```tsx
{(() => {
  type TimelineItem =
    | { kind: 'message'; ts: number; message: Message }
    | { kind: 'flag'; ts: number; flag: Flag };

  const items: TimelineItem[] = [];

  for (const m of messages) {
    items.push({
      kind: 'message',
      ts: m.createdAt ? new Date(m.createdAt).getTime() : 0,
      message: m,
    });
  }
  for (const f of flags) {
    if (f.status === 'RESPONDED' && f.adminResponse && f.respondedAt) {
      items.push({
        kind: 'flag',
        ts: new Date(f.respondedAt).getTime(),
        flag: f,
      });
    }
  }
  items.sort((a, b) => a.ts - b.ts);

  return items.map((item) => {
    if (item.kind === 'message') {
      const m = item.message;
      if (m.sentByAdmin) {
        return (
          <div key={m.id} className="animate-message-in">
            <MessageBubble
              role="admin"
              content={m.content}
              adminName={m.sentByAdmin.name}
              timestamp={m.createdAt}
            />
            {m.seenByOwner === false && (
              <div className="mt-1 text-right text-xs text-amber-600 dark:text-amber-400">new</div>
            )}
          </div>
        );
      }
      return (
        <div key={m.id} className="animate-message-in">
          <MessageBubble role={m.role} content={m.content} attachments={m.attachments} />
        </div>
      );
    }

    return (
      <div key={`flag-${item.flag.id}`} className="animate-message-in">
        <MessageBubble
          role="admin"
          content={item.flag.adminResponse!}
          adminName={item.flag.admin?.name}
          timestamp={item.flag.respondedAt ?? undefined}
        />
      </div>
    );
  });
})()}
```

- [ ] **Step 8: Run the component test**

Run: `npx jest __tests__/components/chat-messages-inline-flags.test.tsx`
Expected: PASS for both tests.

- [ ] **Step 9: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/components/ChatMessages.tsx src/components/MessageBubble.tsx __tests__/components/chat-messages-inline-flags.test.tsx package.json package-lock.json
git commit -m "feat(ui): inline flag responses + admin-sent message bubbles"
```

---

## Task 5: ChatPage — Admin-Send Mode

When the loaded conversation has `isOwner=false && isAdmin=true`, ChatPage:
- Shows a banner.
- Hides the flag button.
- Routes the composer to `POST /api/admin/conversations/[id]/messages` with `{ content }` instead of `/api/chat`.
- Disables composer with tooltip if `!ownerHasClaudeToken` or no `claudeSessionId` (signaled via `ownerHasClaudeToken=false` OR a new flag — we use a derived flag below).

**Files:**
- Modify: `src/components/ChatPage.tsx`

- [ ] **Step 1: Add ownership state**

Near the other `useState` calls (around line 46), add:

```typescript
const [ownership, setOwnership] = useState<{
  isOwner: boolean;
  isAdmin: boolean;
  ownerHasClaudeToken: boolean;
  ownerName: string;
  hasSession: boolean;
} | null>(null);
```

- [ ] **Step 2: Populate `ownership` from the conversation GET response**

In `loadConversation` (around line 80) and in `pollForResponse` (around line 117), after the existing `setMessages(...)` call and before `if (data.flags) ...`, add:

```typescript
setOwnership({
  isOwner: !!data.isOwner,
  isAdmin: !!data.isAdmin,
  ownerHasClaudeToken: !!data.ownerHasClaudeToken,
  ownerName: data.user?.name ?? 'user',
  hasSession: !!data.claudeSessionId,
});
```

Also reset on `handleNewChat` (around line 172):

```typescript
setOwnership(null);
```

- [ ] **Step 3: Update `Message` interface in `ChatPage.tsx` to carry `sentByAdmin` and `createdAt`**

Replace the local `Message` interface (around line 18-23) with:

```typescript
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  attachments?: Attachment[];
  sentByAdmin?: { id: string; name: string } | null;
  seenByOwner?: boolean;
}
```

In `loadConversation` and `pollForResponse`, update the `setMessages` mapping to forward the new fields:

```typescript
setMessages(
  data.messages.map((m: { id: string; role: string; content: string; createdAt?: string; attachments?: Attachment[]; sentByAdmin?: { id: string; name: string } | null; seenByOwner?: boolean }) => ({
    id: m.id,
    role: m.role as 'user' | 'assistant',
    content: m.content,
    createdAt: m.createdAt,
    attachments: m.attachments,
    sentByAdmin: m.sentByAdmin ?? null,
    seenByOwner: m.seenByOwner,
  }))
);
```

(Apply the same update to BOTH `loadConversation` and `pollForResponse`.)

- [ ] **Step 4: Make `handleSend` respect admin-send mode**

Replace the existing `fetch('/api/chat', ...)` call inside `handleSend` (around line 208) with:

```typescript
const isAdminSend = !!(ownership && !ownership.isOwner && ownership.isAdmin);

const res = isAdminSend
  ? await fetch(`/api/admin/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
    })
  : await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, message, attachmentIds }),
    });
```

The remaining SSE consumption code (event types `text`, `tool_use`, `done`, `error`) is identical between the two endpoints, so no further changes needed there.

- [ ] **Step 5: Hide flag button + show admin banner**

In the conversation header block (around line 369-407), wrap the flag-button block so it only renders for the owner:

```tsx
{(!ownership || ownership.isOwner) && (
  <div className="relative">
    {/* existing flag button + form */}
  </div>
)}
```

Just inside the main `<>` fragment near `{conversationId && (` (around line 367), add an admin banner:

```tsx
{ownership && !ownership.isOwner && ownership.isAdmin && (
  <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
    Admin view — you are posting in {ownership.ownerName}&apos;s conversation. Messages you send go to Claude using {ownership.ownerName}&apos;s account.
  </div>
)}
```

- [ ] **Step 6: Disable composer when owner not linked / no session (admin-send mode)**

ChatInput accepts a `disabled` prop. Replace `<ChatInput onSend={handleSend} disabled={isLoading} />` (around line 451) with:

```tsx
{(() => {
  const isAdminSend = !!(ownership && !ownership.isOwner && ownership.isAdmin);
  const adminBlocked = isAdminSend && (!ownership.ownerHasClaudeToken || !ownership.hasSession);
  return (
    <>
      {adminBlocked && (
        <div className="border-t border-gray-200 px-4 py-2 text-center text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {!ownership!.ownerHasClaudeToken
            ? 'Owner has not linked a Claude account.'
            : 'Owner has not started this conversation yet.'}
        </div>
      )}
      <ChatInput onSend={handleSend} disabled={isLoading || adminBlocked} />
    </>
  );
})()}
```

- [ ] **Step 7: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Run all tests**

Run: `npm test`
Expected: All tests PASS (no regressions; new tests from earlier tasks still green).

- [ ] **Step 9: Commit**

```bash
git add src/components/ChatPage.tsx
git commit -m "feat(ui): admin-send mode for non-owned conversations"
```

---

## Task 6: Admin User-Conversations Page

Add a navigation surface so admins can find a user's conversations and click into them.

**Files:**
- Create: `src/app/api/admin/users/[id]/conversations/route.ts`
- Create: `src/app/admin/users/[id]/conversations/page.tsx`
- Modify: `src/app/admin/users/page.tsx` (add a "Conversations" link per row)
- Test: `__tests__/api/admin-user-conversations.test.ts`

- [ ] **Step 1: Write the failing API test**

Create `__tests__/api/admin-user-conversations.test.ts`:

```typescript
import { GET } from '@/app/api/admin/users/[id]/conversations/route';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

jest.mock('next-auth');
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    conversation: { findMany: jest.fn() },
  },
}));

const mockSession = getServerSession as jest.Mock;
const mockUserFind = prisma.user.findUnique as jest.Mock;
const mockConvFindMany = prisma.conversation.findMany as jest.Mock;

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('GET /api/admin/users/[id]/conversations', () => {
  beforeEach(() => jest.clearAllMocks());

  it('401 when not authenticated', async () => {
    mockSession.mockResolvedValue(null);
    const res = await GET(new Request('http://x'), params('u1'));
    expect(res.status).toBe(401);
  });

  it('403 when not admin', async () => {
    mockSession.mockResolvedValue({ user: { email: 'x@x' } });
    mockUserFind.mockResolvedValue({ id: 'u1', role: 'user' });
    const res = await GET(new Request('http://x'), params('u1'));
    expect(res.status).toBe(403);
  });

  it('returns conversations for the requested user when caller is admin', async () => {
    mockSession.mockResolvedValue({ user: { email: 'a@x' } });
    mockUserFind.mockResolvedValue({ id: 'a1', role: 'admin' });
    mockConvFindMany.mockResolvedValue([
      { id: 'c1', title: 'Hello', updatedAt: new Date('2026-04-13'), claudeSessionId: 's' },
    ]);
    const res = await GET(new Request('http://x'), params('u-target'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body[0].id).toBe('c1');
    expect(mockConvFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u-target' },
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api/admin-user-conversations.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Create the API route**

Create `src/app/api/admin/users/[id]/conversations/route.ts`:

```typescript
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET(
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

  const conversations = await prisma.conversation.findMany({
    where: { userId: id },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      claudeSessionId: true,
    },
    orderBy: { updatedAt: 'desc' },
  });

  return NextResponse.json(conversations);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/api/admin-user-conversations.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the admin page**

Create `src/app/admin/users/[id]/conversations/page.tsx`:

```tsx
'use client';

import { useEffect, useState, use } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface ConvRow {
  id: string;
  title: string;
  updatedAt: string;
  claudeSessionId: string | null;
}

export default function AdminUserConversationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { status } = useSession();
  const router = useRouter();
  const [rows, setRows] = useState<ConvRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/users/${id}/conversations`)
      .then((res) => {
        if (res.status === 403) { setError('Forbidden'); return []; }
        if (!res.ok) throw new Error('Failed to load conversations');
        return res.json();
      })
      .then(setRows)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (status === 'loading' || loading) {
    return <div className="flex h-screen items-center justify-center text-gray-400">Loading...</div>;
  }
  if (status === 'unauthenticated') { router.replace('/login'); return null; }
  if (error === 'Forbidden') { router.replace('/'); return null; }
  if (error) {
    return <div className="flex h-screen items-center justify-center text-red-500">{error}</div>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="w-full max-w-3xl rounded-lg bg-white p-8 shadow-md dark:bg-gray-900">
        <h1 className="mb-6 text-xl font-bold text-gray-900 dark:text-gray-100">User Conversations</h1>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500">This user has no conversations yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {rows.map((c) => (
              <li key={c.id} className="py-3">
                <Link
                  href={`/conversation/${c.id}`}
                  className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  {c.title || '(untitled)'}
                </Link>
                <span className="ml-3 text-xs text-gray-400">
                  {new Date(c.updatedAt).toLocaleString('en-GB')}
                  {!c.claudeSessionId && ' · not started'}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-6 border-t border-gray-200 pt-4 dark:border-gray-700">
          <Link href="/admin/users" className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400">
            &larr; Back to users
          </Link>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Add a "Conversations" link in the users table**

In `src/app/admin/users/page.tsx`, in the row's actions cell (around line 154-164 — the cell containing the Delete button), modify it to:

```tsx
<td className="py-3 space-x-3">
  <Link
    href={`/admin/users/${user.id}/conversations`}
    className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400"
  >
    Conversations
  </Link>
  {!isSelf && (
    <button
      onClick={() => deleteUser(user.id, user.name)}
      className="text-xs text-gray-400 hover:text-red-500 dark:text-gray-500"
      title="Delete user"
    >
      Delete
    </button>
  )}
</td>
```

- [ ] **Step 7: Run typecheck and tests**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/admin/users/\[id\]/conversations/route.ts src/app/admin/users/\[id\]/conversations/page.tsx src/app/admin/users/page.tsx __tests__/api/admin-user-conversations.test.ts
git commit -m "feat(admin): browse a user's conversations from admin users page"
```

---

## Task 7: End-to-End Manual Verification + Build

- [ ] **Step 1: Run the build**

Run: `npm run build`
Expected: Build succeeds with no errors. Note any warnings.

- [ ] **Step 2: Start dev server and walk through happy path**

Run: `npm run dev`

In a browser, as an admin user:
1. Visit `/admin/users` — confirm a "Conversations" link appears next to each user.
2. Click "Conversations" for a non-self user that has at least one conversation already started.
3. Click into any conversation in that list.
4. Verify: amber banner shows "Admin view — you are posting in {name}'s conversation."
5. Verify: flag button is hidden.
6. Type a message and submit.
7. Verify: message appears immediately as an admin-styled bubble with "Admin — {your name}".
8. Verify: assistant reply streams and is rendered normally.

- [ ] **Step 3: Verify owner-side**

Log in as the conversation's original owner (or use a separate browser/profile):
1. Open the same conversation.
2. Verify: the admin's message and the assistant's reply both show, in chronological order with any prior turns.
3. Verify: the admin's bubble is rendered with admin styling and "new" indicator.
4. Reload the conversation and confirm the "new" indicator is gone (it was marked seen on the previous load).

- [ ] **Step 4: Verify flag-resolution side effect**

1. As a normal user, flag a conversation.
2. As an admin, open that user's conversation and post an admin message.
3. Visit `/admin/flags` and confirm the flag is now in the RESPONDED tab, with the admin's name set.

- [ ] **Step 5: Verify guard cases (manual)**

1. As an admin, navigate to a conversation owned by a user who has not linked Claude (find or unset one in DB if needed). Confirm the composer is disabled with the "Owner has not linked a Claude account." footer.
2. As an admin, navigate to a brand-new conversation that has never been chatted in (no `claudeSessionId`). Confirm the composer is disabled with "Owner has not started this conversation yet." footer.

- [ ] **Step 6: Final test + lint pass**

Run: `npm test`
Expected: All tests PASS.

Run: `npm run lint`
Expected: PASS (or: no new lint errors compared to main).

- [ ] **Step 7: Final commit if any small fixes were needed**

```bash
git status
# if anything was tweaked during manual QA:
git add -p
git commit -m "fix: minor tweaks from admin justify QA"
```

- [ ] **Step 8: Push branch**

```bash
git push -u origin feature/admin-justify
```

Confirm a PR is opened or open one manually via `gh pr create` after explicit user confirmation.
