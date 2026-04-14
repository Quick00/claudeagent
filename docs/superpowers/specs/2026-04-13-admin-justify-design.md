# Admin Justify — Design Spec

**Date:** 2026-04-13
**Branch:** `feature/admin-justify`
**Status:** Draft, awaiting user review

## Goal

Let an admin post a message into another user's conversation, attributed clearly to the admin, with Claude responding using the conversation owner's Claude token. As a paired UX improvement, refactor the existing flag-response display so admin flag-replies appear inline with the chat by timestamp instead of always at the bottom.

## Out of Scope

- Cross-admin permissions (any admin can post in any conversation).
- Editing or revoking admin messages.
- Multi-admin presence indicators or write locking.
- Admins flagging others' conversations.

---

## 1. Data Model

Extend `Message` with admin attribution; no new model.

```prisma
model Message {
  id             String       @id @default(uuid())
  conversationId String
  role           String       // "user" | "assistant" — unchanged; admin-sent rows still role="user"
  content        String
  createdAt      DateTime     @default(now())
  sentByAdminId  String?
  seenByOwner    Boolean      @default(true)
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  attachments    Attachment[]
  sentByAdmin    User?        @relation("AdminSentMessages", fields: [sentByAdminId], references: [id], onDelete: SetNull)

  @@index([sentByAdminId])
}

model User {
  // …existing
  adminSentMessages Message[] @relation("AdminSentMessages")
}
```

**Rationale**

- `role` stays `"user"` because that is what Claude actually saw — keeps replay/resume semantics correct.
- `sentByAdminId` carries display attribution and audit trail.
- `seenByOwner` mirrors `Flag.seenByUser` for the notification UX. Default `true` so existing rows are no-ops; admin-inserted rows are explicitly created with `false`.
- One migration adds both columns, the relation, and the index. No backfill required.

---

## 2. API Surface

### New: `POST /api/admin/conversations/[id]/messages`

- Auth: session required; current user must be `role === 'admin'`.
- Loads conversation by `id`. Rejects with **400** if the requester *is* the owner (admins use the normal chat path on their own conversations).
- Loads `conversation.user` (owner). Rejects with **409** `"Owner has not linked a Claude account"` if `owner.claudeToken` is null.
- Body: `{ content: string }`.
- Persists the admin's message with `role: "user"`, `sentByAdminId: currentUser.id`, `seenByOwner: false`.
- Streams Claude via the same SSE path as `/api/chat`, but with the **owner's** decrypted `claudeToken` and the conversation's `claudeSessionId`.
- On completion, persists the assistant message with `seenByOwner: false`.
- Updates `conversation.claudeSessionId` if Claude returns a new one (existing behavior).
- **Resolves any PENDING flags on the conversation**: in the same transaction as persisting the admin message, `updateMany` all `Flag` rows with `conversationId == id` and `status == "PENDING"` to `status: "RESPONDED"`, `adminId: currentUser.id`, `respondedAt: now`. Leaves `adminResponse` null — the inline admin Message bubble is the answer, so the existing flag-response render path (which requires non-null `adminResponse`) does not produce a duplicate bubble.

### Changed: `GET /api/conversations/[id]`

- Already returns messages. Include `sentByAdmin: { id, name } | null` and `seenByOwner` per message. Backward-compatible additions.
- Authorization broadened: owner OR admin. Admins reading non-owned conversations is new — required for the admin view to load.
- When the requester is the owner, mark all `seenByOwner: false` messages as `true` in a single `updateMany`, mirroring the flag seen-flow. Admin reads do not clear `seenByOwner`.

### Unchanged

`POST /api/chat` — owner-only path. Admins use the new endpoint above when posting in others' conversations.

---

## 3. Frontend

### Routing & access

- `/conversation/[id]` (already loads `ChatPage`) gets ownership context from the `GET /api/conversations/[id]` response, which is extended to include `isOwner: boolean`, `isAdmin: boolean`, `ownerHasClaudeToken: boolean`. (Avoids a second round-trip and keeps the existing client-side fetch flow.)
- `!isOwner && isAdmin` → render `ChatPage` in **admin-send mode**.
- `!isOwner && !isAdmin` → 403 (unchanged).

### Admin Users page hookup

- Add a "Conversations" affordance per user on `/admin/users` — a small button or link that drills into `/admin/users/[id]/conversations`, listing the user's conversations (titles, updatedAt) with each title linking to `/conversation/[id]`.
- Reuse existing admin styling. New small page.

### `ChatPage` in admin-send mode

- Header banner: `"Admin view — you are posting as {admin.name} into {owner.name}'s conversation."`
- Hide the flag button.
- Composer enabled; submits go to `POST /api/admin/conversations/[id]/messages` instead of `/api/chat`. SSE handling is otherwise identical.
- If `!ownerHasClaudeToken`, composer is disabled with tooltip: `"Owner has not linked a Claude account."`

### `ChatMessages` — bubble styling

- `MessageBubble` already supports `role="admin"` with `adminName` / `timestamp`. Reuse it.
- For any message with `sentByAdmin`, render with `role="admin"`, label `"Sent by {sentByAdmin.name} (Admin)"`, distinct background, right-aligned (matches today's flag-response admin bubble).
- Owner-side: small `"new"` dot on bubbles where `seenByOwner === false`, cleared after the owner views the conversation (the GET marks them seen; the dot disappears on next render).

### `ChatMessages` — inline flag responses

- Build a single chronologically-sorted timeline by merging:
  - `messages` (sorted by `createdAt`)
  - `flags.filter(f => f.status === 'RESPONDED' && f.adminResponse)` (sorted by `respondedAt`)
- Render the merged list in one pass. Visual per item is unchanged; only ordering changes.

---

## 4. Error Handling & Edge Cases

- **Owner has no `claudeToken`** → 409 with explicit message; UI disables composer.
- **Owner's token is expired/invalid** → Claude CLI errors on send; SSE returns an error frame; surfaced like existing chat errors. No special-casing.
- **Conversation has no `claudeSessionId`** (never chatted) → 409 `"Conversation has not been started by the owner yet"`. Composer disabled with tooltip. Rationale: avoids duplicating the chat route's full setup pipeline (repo routing, knowledge embedding, system-prompt assembly) in the admin endpoint for an edge case that is rare in practice.
- **Owner deletes their account mid-conversation** → cascade deletes the conversation; admin gets 404 on next send.
- **Two admins post simultaneously** → no locking; both rows persist with their own `createdAt`. Acceptable; rare.
- **Admin posts via admin endpoint on their own conversation** → 400. They use `/api/chat`.

---

## 5. Testing

### API

- `POST /api/admin/conversations/[id]/messages`:
  - non-admin → 403
  - admin-on-own-conversation → 400
  - owner-without-token → 409
  - happy path persists `sentByAdminId` and `seenByOwner=false`
  - any PENDING flags on the conversation are flipped to RESPONDED with this admin's id and `adminResponse` left null
  - already-RESPONDED flags are not modified
- `GET /api/conversations/[id]`:
  - flips `seenByOwner` to `true` when the requester is the owner
  - leaves `seenByOwner` untouched when the requester is an admin viewing
  - returns 403 for non-owner non-admin

### UI

- `ChatMessages` merge-sort renders messages and responded flags interleaved by timestamp (snapshot or shallow render assertion).
- `ChatPage` admin-send mode swaps endpoints, shows the banner, hides the flag button.
- Composer disabled with tooltip when `!ownerHasClaudeToken`.

### Integration

- Existing chat tests untouched.

---

## 6. Migration

Single Prisma migration:

- Adds `Message.sentByAdminId` (nullable FK to `User.id`, `ON DELETE SET NULL`).
- Adds `Message.seenByOwner` (boolean, default `true`).
- Adds index on `Message.sentByAdminId`.
- No data backfill needed; defaults handle existing rows.
