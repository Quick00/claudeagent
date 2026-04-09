# Conversation Flagging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to flag conversations where their question wasn't answered, and let admins respond with a distinct admin message bubble visible in the chat.

**Architecture:** New `Flag` Prisma model linked to `Conversation` and `User` (two relations: flagger and responder). REST API routes for CRUD + notifications. Frontend adds a flag button in the chat header, notification badges in the sidebar, admin response bubbles in the message list, and a dedicated admin flags management page.

**Tech Stack:** Next.js 16 App Router, Prisma 7.6 (PostgreSQL), NextAuth.js 4 (JWT sessions), React 19, Tailwind CSS 4

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `src/app/api/flags/route.ts` | POST (create flag), GET (admin list all flags) |
| `src/app/api/flags/[id]/route.ts` | PATCH (admin respond to flag) |
| `src/app/api/flags/[id]/seen/route.ts` | PATCH (user mark flag as seen) |
| `src/app/api/flags/notifications/route.ts` | GET (user's unseen responded flags) |
| `src/app/admin/flags/page.tsx` | Admin flags management page |

### Modified files
| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Add Flag model, add relations to User and Conversation |
| `src/components/ChatSidebar.tsx` | Add Flags admin link, fetch notifications, show badge dots on conversations |
| `src/components/ChatPage.tsx` | Add flag button in header, fetch flags for conversation, mark seen, pass flags to ChatMessages |
| `src/components/ChatMessages.tsx` | Accept flags prop, render admin response bubbles |
| `src/components/MessageBubble.tsx` | Add `admin` role variant with amber styling |

---

### Task 1: Prisma Schema — Add Flag Model

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the Flag model and update relations**

In `prisma/schema.prisma`, add the Flag model at the bottom and update User and Conversation with new relations:

```prisma
model Flag {
  id             String    @id @default(uuid())
  conversationId String
  userId         String
  reason         String    @default("")
  status         String    @default("PENDING")
  adminResponse  String?
  adminId        String?
  respondedAt    DateTime?
  seenByUser     Boolean   @default(false)
  createdAt      DateTime  @default(now())

  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  user           User         @relation("UserFlags", fields: [userId], references: [id], onDelete: Cascade)
  admin          User?        @relation("AdminFlags", fields: [adminId], references: [id], onDelete: SetNull)
}
```

Add to the `User` model (after `conversations`):
```prisma
  flags            Flag[] @relation("UserFlags")
  adminFlags       Flag[] @relation("AdminFlags")
```

Add to the `Conversation` model (after `messages`):
```prisma
  flags           Flag[]
```

- [ ] **Step 2: Generate migration and Prisma client**

Run:
```bash
npx prisma migrate dev --name add_flags
```
Expected: Migration created successfully, Prisma client regenerated.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add Flag model to Prisma schema"
```

---

### Task 2: API — Create Flag (POST /api/flags)

**Files:**
- Create: `src/app/api/flags/route.ts`

- [ ] **Step 1: Create the POST handler for creating flags**

Create `src/app/api/flags/route.ts`:

```typescript
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

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

  const { conversationId, reason } = (await request.json()) as {
    conversationId: string;
    reason?: string;
  };

  if (!conversationId) {
    return new Response('conversationId is required', { status: 400 });
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId: user.id },
  });
  if (!conversation) {
    return new Response('Conversation not found', { status: 404 });
  }

  const flag = await prisma.flag.create({
    data: {
      conversationId,
      userId: user.id,
      reason: reason || '',
    },
  });

  return NextResponse.json(flag, { status: 201 });
}
```

- [ ] **Step 2: Verify the endpoint works**

Run:
```bash
npm run build
```
Expected: Build succeeds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/flags/route.ts
git commit -m "feat: add POST /api/flags endpoint for creating flags"
```

---

### Task 3: API — List Flags for Admin (GET /api/flags)

**Files:**
- Modify: `src/app/api/flags/route.ts`

- [ ] **Step 1: Add the GET handler to the flags route**

Add this function to `src/app/api/flags/route.ts` (after the POST handler):

```typescript
export async function GET() {
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

  const flags = await prisma.flag.findMany({
    orderBy: [
      { status: 'asc' },
      { createdAt: 'desc' },
    ],
    include: {
      conversation: {
        select: { id: true, title: true },
      },
      user: {
        select: { id: true, name: true, email: true },
      },
      admin: {
        select: { id: true, name: true },
      },
    },
  });

  return NextResponse.json(flags);
}
```

- [ ] **Step 2: Verify build**

Run:
```bash
npm run build
```
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/flags/route.ts
git commit -m "feat: add GET /api/flags endpoint for admin flag listing"
```

---

### Task 4: API — Admin Respond to Flag (PATCH /api/flags/[id])

**Files:**
- Create: `src/app/api/flags/[id]/route.ts`

- [ ] **Step 1: Create the PATCH handler**

Create `src/app/api/flags/[id]/route.ts`:

```typescript
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function PATCH(
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
  const { adminResponse } = (await request.json()) as { adminResponse: string };

  if (!adminResponse?.trim()) {
    return new Response('adminResponse is required', { status: 400 });
  }

  const flag = await prisma.flag.findUnique({ where: { id } });
  if (!flag) {
    return new Response('Flag not found', { status: 404 });
  }

  const updated = await prisma.flag.update({
    where: { id },
    data: {
      adminResponse,
      status: 'RESPONDED',
      adminId: currentUser.id,
      respondedAt: new Date(),
      seenByUser: false,
    },
  });

  return NextResponse.json(updated);
}
```

- [ ] **Step 2: Verify build**

Run:
```bash
npm run build
```
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/flags/[id]/route.ts
git commit -m "feat: add PATCH /api/flags/[id] for admin flag responses"
```

---

### Task 5: API — Notifications + Mark Seen

**Files:**
- Create: `src/app/api/flags/notifications/route.ts`
- Create: `src/app/api/flags/[id]/seen/route.ts`

- [ ] **Step 1: Create the notifications endpoint**

Create `src/app/api/flags/notifications/route.ts`:

```typescript
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET() {
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

  const unseenFlags = await prisma.flag.findMany({
    where: {
      userId: user.id,
      status: 'RESPONDED',
      seenByUser: false,
    },
    select: {
      id: true,
      conversationId: true,
    },
  });

  const conversationIds = [...new Set(unseenFlags.map((f) => f.conversationId))];

  return NextResponse.json({
    count: unseenFlags.length,
    conversationIds,
    flags: unseenFlags,
  });
}
```

- [ ] **Step 2: Create the mark-seen endpoint**

Create `src/app/api/flags/[id]/seen/route.ts`:

```typescript
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function PATCH(
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

  const flag = await prisma.flag.findFirst({
    where: { id, userId: user.id },
  });
  if (!flag) {
    return new Response('Flag not found', { status: 404 });
  }

  await prisma.flag.update({
    where: { id },
    data: { seenByUser: true },
  });

  return new Response(null, { status: 204 });
}
```

- [ ] **Step 3: Verify build**

Run:
```bash
npm run build
```
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/flags/notifications/route.ts src/app/api/flags/[id]/seen/route.ts
git commit -m "feat: add flag notifications and mark-seen endpoints"
```

---

### Task 6: MessageBubble — Add Admin Variant

**Files:**
- Modify: `src/components/MessageBubble.tsx`

- [ ] **Step 1: Add admin role support to MessageBubble**

Replace the contents of `src/components/MessageBubble.tsx` with:

```tsx
'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'admin';
  content: string;
  adminName?: string;
  timestamp?: string;
}

export default function MessageBubble({ role, content, adminName, timestamp }: MessageBubbleProps) {
  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl bg-blue-600 px-4 py-3 text-white">
          <p className="whitespace-pre-wrap">{content}</p>
        </div>
      </div>
    );
  }

  if (role === 'admin') {
    return (
      <div className="flex justify-start">
        <div className="w-full overflow-hidden rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-gray-900">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium text-amber-700">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <span>Admin{adminName ? ` — ${adminName}` : ''}</span>
            {timestamp && (
              <span className="text-amber-500">{new Date(timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            )}
          </div>
          <p className="whitespace-pre-wrap text-sm">{content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="w-full overflow-hidden rounded-2xl bg-gray-100 px-4 py-3 text-gray-900">
        <div className="prose prose-sm max-w-none overflow-x-auto prose-table:text-sm prose-pre:bg-gray-800 prose-pre:text-gray-100 prose-code:text-pink-600">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run:
```bash
npm run build
```
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/MessageBubble.tsx
git commit -m "feat: add admin role variant to MessageBubble"
```

---

### Task 7: ChatMessages — Render Admin Response Bubbles

**Files:**
- Modify: `src/components/ChatMessages.tsx`

- [ ] **Step 1: Add flags prop and render admin response bubbles**

In `src/components/ChatMessages.tsx`, update the interface and component to accept and render flags.

Add this interface after the existing `Message` interface:

```typescript
interface Flag {
  id: string;
  status: string;
  adminResponse: string | null;
  respondedAt: string | null;
  admin: { name: string } | null;
}
```

Add `flags` to the `ChatMessagesProps` interface:

```typescript
interface ChatMessagesProps {
  messages: Message[];
  streamingContent: string;
  toolStatus: string | null;
  isLoading: boolean;
  onSendSuggestion: (message: string) => void;
  flags: Flag[];
}
```

Update the component signature to destructure `flags`:

```typescript
export default function ChatMessages({
  messages,
  streamingContent,
  toolStatus,
  isLoading,
  onSendSuggestion,
  flags,
}: ChatMessagesProps) {
```

In the message list rendering section (inside `return` of the non-empty state), add admin response bubbles after the messages map and before the streaming content. Insert this right after `{messages.map((msg) => (...))}`:

```tsx
        {flags
          .filter((f) => f.status === 'RESPONDED' && f.adminResponse)
          .map((flag) => (
            <MessageBubble
              key={`flag-${flag.id}`}
              role="admin"
              content={flag.adminResponse!}
              adminName={flag.admin?.name}
              timestamp={flag.respondedAt ?? undefined}
            />
          ))}
```

- [ ] **Step 2: Verify build**

Run:
```bash
npm run build
```
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/ChatMessages.tsx
git commit -m "feat: render admin response bubbles in ChatMessages"
```

---

### Task 8: ChatPage — Flag Button + Fetch Flags + Mark Seen

**Files:**
- Modify: `src/components/ChatPage.tsx`

- [ ] **Step 1: Add flag state and fetching logic**

In `src/components/ChatPage.tsx`, add the Flag interface after the Message interface:

```typescript
interface Flag {
  id: string;
  status: string;
  adminResponse: string | null;
  respondedAt: string | null;
  admin: { name: string } | null;
  seenByUser: boolean;
}
```

Add new state variables after the existing state declarations (after `const [showLinkModal, setShowLinkModal] = useState(false);`):

```typescript
  const [flags, setFlags] = useState<Flag[]>([]);
  const [showFlagForm, setShowFlagForm] = useState(false);
  const [flagReason, setFlagReason] = useState('');
  const [flagSubmitting, setFlagSubmitting] = useState(false);
```

Add a `fetchFlags` function after `fetchClaudeStatus`:

```typescript
  const fetchFlags = useCallback(async (convId: string) => {
    try {
      const res = await fetch(`/api/conversations/${convId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.flags) {
        setFlags(data.flags);
        // Mark unseen responded flags as seen
        for (const flag of data.flags) {
          if (flag.status === 'RESPONDED' && !flag.seenByUser) {
            fetch(`/api/flags/${flag.id}/seen`, { method: 'PATCH' }).catch(() => {});
          }
        }
      }
    } catch {}
  }, []);
```

In the `loadConversation` callback, add `setFlags([]);` in the reset block (after `setIsLoading(false);`), and call `fetchFlags(id);` at the end (after setting messages from the API response).

Add the handleFlag function after handleSend:

```typescript
  const handleFlag = async () => {
    if (!conversationId || flagSubmitting) return;
    setFlagSubmitting(true);
    try {
      const res = await fetch('/api/flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, reason: flagReason }),
      });
      if (res.ok) {
        const flag = await res.json();
        setFlags((prev) => [...prev, flag]);
        setShowFlagForm(false);
        setFlagReason('');
      }
    } finally {
      setFlagSubmitting(false);
    }
  };
```

- [ ] **Step 2: Add flag button UI and pass flags to ChatMessages**

In the JSX, add a chat header with the flag button. Replace the section that renders `ChatMessages` and `ChatInput` (inside the `claudeLinked !== false` branch):

```tsx
          <>
            {conversationId && (
              <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
                <div />
                <div className="relative">
                  <button
                    onClick={() => setShowFlagForm(!showFlagForm)}
                    className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      flags.some((f) => f.status === 'PENDING')
                        ? 'bg-red-50 text-red-600'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                    title="Flag this conversation"
                  >
                    <svg className="h-3.5 w-3.5" fill={flags.some((f) => f.status === 'PENDING') ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
                    </svg>
                    {flags.some((f) => f.status === 'PENDING') ? 'Flagged' : 'Flag'}
                  </button>
                  {showFlagForm && (
                    <div className="absolute right-0 top-full z-10 mt-1 w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
                      <textarea
                        value={flagReason}
                        onChange={(e) => setFlagReason(e.target.value)}
                        placeholder="What was wrong? (optional)"
                        className="w-full resize-none rounded-md border border-gray-200 p-2 text-sm focus:border-blue-300 focus:outline-none"
                        rows={2}
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <button
                          onClick={() => { setShowFlagForm(false); setFlagReason(''); }}
                          className="rounded-md px-3 py-1 text-xs text-gray-500 hover:bg-gray-100"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleFlag}
                          disabled={flagSubmitting}
                          className="rounded-md bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          {flagSubmitting ? 'Flagging...' : 'Submit Flag'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            <ChatMessages
              messages={messages}
              streamingContent={streamingContent}
              toolStatus={toolStatus}
              isLoading={isLoading}
              onSendSuggestion={handleSend}
              flags={flags}
            />
            <ChatInput onSend={handleSend} disabled={isLoading} />
          </>
```

- [ ] **Step 3: Update loadConversation to also fetch flags**

Update the `loadConversation` callback. After `setMessages(...)`, add the flag data from the same response. The conversation endpoint already includes relations, so we need to update it to include flags. For now, add a separate fetch:

In `loadConversation`, after `setMessages(data.messages.map(...))`, add:

```typescript
    fetchFlags(id);
```

And add `setFlags([]);` after `setToolStatus(null);` in the reset block at the top of `loadConversation`.

Also add `setFlags([]);` in `handleNewChat` after `setIsLoading(false);`.

- [ ] **Step 4: Verify build**

Run:
```bash
npm run build
```
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatPage.tsx
git commit -m "feat: add flag button and flag fetching to ChatPage"
```

---

### Task 9: Update Conversation API to Include Flags

**Files:**
- Modify: `src/app/api/conversations/[id]/route.ts`

- [ ] **Step 1: Include flags in conversation response**

In `src/app/api/conversations/[id]/route.ts`, update the `prisma.conversation.findFirst` call in the GET handler to include flags. Change the `include` block:

```typescript
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
      },
      flags: {
        include: {
          admin: {
            select: { id: true, name: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
```

- [ ] **Step 2: Verify build**

Run:
```bash
npm run build
```
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/conversations/[id]/route.ts
git commit -m "feat: include flags in conversation API response"
```

---

### Task 10: ChatSidebar — Notification Badges + Admin Flags Link

**Files:**
- Modify: `src/components/ChatSidebar.tsx`

- [ ] **Step 1: Add notification state and fetching**

In `src/components/ChatSidebar.tsx`, add state for notification conversation IDs. After the existing `conversations` state:

```typescript
  const [notificationConvIds, setNotificationConvIds] = useState<Set<string>>(new Set());
```

Add a useEffect to fetch notifications (after the conversations useEffect):

```typescript
  useEffect(() => {
    const fetchNotifications = () => {
      fetch('/api/flags/notifications')
        .then((res) => res.json())
        .then((data) => {
          setNotificationConvIds(new Set(data.conversationIds || []));
        })
        .catch(() => {});
    };

    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [refreshTrigger]);
```

- [ ] **Step 2: Add notification dot to conversation items**

In the conversation list rendering, add a notification dot after the conversation title. Update the conversation item JSX:

Replace:
```tsx
            <span className="truncate">{conv.title}</span>
```

With:
```tsx
            <span className="flex items-center gap-1.5 truncate">
              {conv.title}
              {notificationConvIds.has(conv.id) && (
                <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-red-500" />
              )}
            </span>
```

- [ ] **Step 3: Add Flags admin link in sidebar navigation**

In the sidebar nav section, add a Flags link after the existing Users admin link. After the `{(session?.user as any)?.role === 'admin' && (` block that renders the Users link, add another admin-only link:

```tsx
        {(session?.user as any)?.role === 'admin' && (
          <a
            href="/admin/flags"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-200"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
            </svg>
            Flags
          </a>
        )}
```

- [ ] **Step 4: Verify build**

Run:
```bash
npm run build
```
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatSidebar.tsx
git commit -m "feat: add notification badges and Flags admin link to sidebar"
```

---

### Task 11: Admin Flags Page

**Files:**
- Create: `src/app/admin/flags/page.tsx`

- [ ] **Step 1: Create the admin flags management page**

Create `src/app/admin/flags/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';

interface FlagRow {
  id: string;
  reason: string;
  status: string;
  adminResponse: string | null;
  createdAt: string;
  respondedAt: string | null;
  conversation: { id: string; title: string };
  user: { id: string; name: string; email: string };
  admin: { id: string; name: string } | null;
}

export default function AdminFlagsPage() {
  const { data: session, status } = useSession();
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [responseText, setResponseText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch('/api/flags')
      .then((res) => {
        if (res.status === 403) {
          setError('Forbidden');
          return [];
        }
        if (!res.ok) throw new Error('Failed to fetch flags');
        return res.json();
      })
      .then(setFlags)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleRespond = async (flagId: string) => {
    if (!responseText.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/flags/${flagId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminResponse: responseText }),
      });
      if (!res.ok) return;
      const updated = await res.json();
      setFlags((prev) =>
        prev.map((f) =>
          f.id === flagId
            ? {
                ...f,
                status: updated.status,
                adminResponse: updated.adminResponse,
                respondedAt: updated.respondedAt,
                admin: { id: (session?.user as any)?.id, name: session?.user?.name || 'Admin' },
              }
            : f
        )
      );
      setRespondingTo(null);
      setResponseText('');
    } finally {
      setSubmitting(false);
    }
  };

  if (status === 'loading' || loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    redirect('/login');
  }

  if (error === 'Forbidden') {
    redirect('/');
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-red-500">{error}</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-5xl rounded-lg bg-white p-8 shadow-md">
        <h1 className="mb-6 text-xl font-bold text-gray-900">Flagged Conversations</h1>

        {flags.length === 0 ? (
          <p className="text-gray-500">No flagged conversations yet.</p>
        ) : (
          <div className="space-y-4">
            {flags.map((flag) => (
              <div
                key={flag.id}
                className={`rounded-lg border p-4 ${
                  flag.status === 'PENDING' ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          flag.status === 'PENDING'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-green-100 text-green-700'
                        }`}
                      >
                        {flag.status}
                      </span>
                      <a
                        href={`/conversation/${flag.conversation.id}`}
                        className="text-sm font-medium text-blue-600 hover:text-blue-700"
                      >
                        {flag.conversation.title}
                      </a>
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      Flagged by <span className="font-medium">{flag.user.name}</span> ({flag.user.email})
                      {' — '}
                      {new Date(flag.createdAt).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                    {flag.reason && (
                      <p className="mt-2 text-sm text-gray-700">
                        <span className="font-medium">Reason:</span> {flag.reason}
                      </p>
                    )}
                    {flag.adminResponse && (
                      <div className="mt-3 rounded-md border border-green-200 bg-white p-3">
                        <div className="text-xs font-medium text-green-700">
                          Response by {flag.admin?.name || 'Admin'}
                          {flag.respondedAt && (
                            <span className="ml-2 font-normal text-gray-400">
                              {new Date(flag.respondedAt).toLocaleDateString('en-GB', {
                                day: 'numeric',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-gray-700">{flag.adminResponse}</p>
                      </div>
                    )}
                  </div>
                  <div className="ml-4">
                    {flag.status === 'PENDING' && (
                      <button
                        onClick={() => {
                          setRespondingTo(respondingTo === flag.id ? null : flag.id);
                          setResponseText('');
                        }}
                        className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                      >
                        Respond
                      </button>
                    )}
                  </div>
                </div>
                {respondingTo === flag.id && (
                  <div className="mt-3 border-t border-red-200 pt-3">
                    <textarea
                      value={responseText}
                      onChange={(e) => setResponseText(e.target.value)}
                      placeholder="Write your response to the user..."
                      className="w-full resize-none rounded-md border border-gray-200 p-2 text-sm focus:border-blue-300 focus:outline-none"
                      rows={3}
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        onClick={() => { setRespondingTo(null); setResponseText(''); }}
                        className="rounded-md px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleRespond(flag.id)}
                        disabled={!responseText.trim() || submitting}
                        className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {submitting ? 'Sending...' : 'Send Response'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 border-t border-gray-200 pt-4">
          <a href="/" className="text-sm text-blue-600 hover:text-blue-700">
            &larr; Back to chat
          </a>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run:
```bash
npm run build
```
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/flags/page.tsx
git commit -m "feat: add admin flags management page"
```

---

### Task 12: Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full build**

Run:
```bash
npm run build
```
Expected: Build succeeds with no errors.

- [ ] **Step 2: Run tests**

Run:
```bash
npm test
```
Expected: All existing tests pass.

- [ ] **Step 3: Manual smoke test checklist**

Verify these flows work in the browser:
1. Open a conversation, see the Flag button in the header
2. Click Flag, enter optional reason, submit — see "Flagged" state
3. As admin, navigate to `/admin/flags` — see the flagged conversation
4. Respond to the flag from the admin page
5. As user, see the notification dot on the conversation in the sidebar
6. Open the conversation — see the admin response bubble at the bottom
7. Notification dot clears after opening the conversation

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address issues found during smoke testing"
```
