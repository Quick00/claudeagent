# Conversation Flagging System — Design Spec

## Purpose

Allow users to flag conversations where their question wasn't adequately answered. Admins see a queue of flagged conversations, can review them, and write a response that appears as a distinct admin message bubble in the chat. Users get a notification badge in the sidebar when an admin responds to their flag.

## Data Model

### New `Flag` model (Prisma)

```prisma
model Flag {
  id             String    @id @default(uuid())
  conversationId String
  userId         String
  reason         String    @default("")
  status         String    @default("PENDING") // PENDING | RESPONDED
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

- Multiple flags per conversation are supported (each is its own row).
- `seenByUser` tracks whether the user has seen the admin response (drives the notification badge).
- `User` gets two new relations: `flags` (as flagger) and `adminFlags` (as responder).
- `Conversation` gets a `flags` relation.

## API Routes

### POST `/api/flags` — Create flag (user)

- Auth: session required
- Body: `{ conversationId: string, reason?: string }`
- Validates the conversation belongs to the user
- Creates a Flag with status `PENDING`
- Returns the created flag

### GET `/api/flags` — List flags (admin)

- Auth: admin role required
- Returns all flags with related conversation (title), user (name, email), and admin (name) data
- Ordered: PENDING first, then by createdAt descending
- Includes conversation messages for context

### PATCH `/api/flags/[id]` — Respond to flag (admin)

- Auth: admin role required
- Body: `{ adminResponse: string }`
- Sets `adminResponse`, `status` = `RESPONDED`, `adminId`, `respondedAt`
- Returns updated flag

### GET `/api/flags/notifications` — Unseen responses (user)

- Auth: session required
- Returns flags where `userId` = current user, `status` = `RESPONDED`, `seenByUser` = false
- Returns count and list of conversation IDs with unseen responses

### PATCH `/api/flags/[id]/seen` — Mark as seen (user)

- Auth: session required, must own the flag
- Sets `seenByUser` = true

## Frontend Components

### 1. Flag Button — Chat header

- Visible to all authenticated users when viewing a conversation
- Small flag icon button in the top area of the chat (next to conversation title or in a header bar)
- Clicking opens a small inline form or modal: optional textarea for reason + submit button
- After flagging: shows a "Flagged" indicator (filled flag icon)

### 2. Admin Flags Page — `/admin/flags`

- New page, admin-only (same pattern as `/admin/users`)
- Table/list showing: User name, Conversation title (clickable link), Reason, Date, Status badge
- Each row has a "Respond" action that expands an inline textarea + submit
- After responding, status updates to "RESPONDED" with green badge
- Navigation link added to sidebar (visible to admins only)

### 3. Sidebar Notification Badge

- `ChatSidebar` fetches `/api/flags/notifications` on mount and periodically
- Shows a red dot/count badge on conversations that have unseen admin responses
- Badge clears when user opens the conversation (triggers PATCH `/api/flags/[id]/seen`)

### 4. Admin Response Bubble — In chat messages

- When loading conversation messages, also fetch flags for that conversation
- For each flag with `status === 'RESPONDED'`, render a distinct bubble at the end of the message list
- Visual style: amber/orange background, "Admin" label with admin name, different from user (blue) and assistant (gray) bubbles
- Shows the admin response text and timestamp

## File Changes Summary

### New files
- `src/app/api/flags/route.ts` — POST (create), GET (list)
- `src/app/api/flags/[id]/route.ts` — PATCH (respond)
- `src/app/api/flags/[id]/seen/route.ts` — PATCH (mark seen)
- `src/app/api/flags/notifications/route.ts` — GET (unseen count)
- `src/app/admin/flags/page.tsx` — Admin flags page
- `prisma/migrations/[timestamp]_add_flags/migration.sql`

### Modified files
- `prisma/schema.prisma` — Add Flag model, update User + Conversation relations
- `src/components/ChatSidebar.tsx` — Add admin flags link, notification badges
- `src/components/ChatPage.tsx` — Add flag button, fetch flags for conversation, pass to ChatMessages
- `src/components/ChatMessages.tsx` — Render admin response bubbles
- `src/components/MessageBubble.tsx` — Add admin variant (or new AdminResponseBubble)

## Edge Cases

- User flags same conversation multiple times: allowed (each flag is independent)
- Admin responds to a flag, user flags again: creates a new PENDING flag
- Conversation deleted: flags cascade-delete via `onDelete: Cascade`
- User deleted: their flags cascade-delete
- Admin deleted: `adminId` set to null via `onDelete: SetNull`
