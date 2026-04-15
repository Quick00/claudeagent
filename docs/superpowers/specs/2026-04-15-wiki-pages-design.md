# Wiki Pages — Design Spec

**Date:** 2026-04-15
**Branch:** `feature/wiki-pages`
**Status:** Draft for review

## Summary

Add user-triggered, Claude-authored wiki pages to the app. A user types a topic, a background job runs Claude against the codebase using that user's Claude token, and the result is saved as a markdown page visible to all users. Any user can regenerate any page with an optional extra prompt; regeneration overwrites the body and uses the regenerator's Claude token. Admins can delete pages.

Wiki pages are aimed at **non-technical support staff** — the audience for the product as a whole. Generated content explains product behaviour in plain English, with no file paths, code, or developer-level references.

## Goals

- Let support staff build a shared, curated library of "how does X work" articles on top of the existing codebase Q&A pipeline.
- Reuse the existing Claude Code CLI integration (session manager, streaming, sanitization) rather than introducing new AI plumbing.
- Keep v1 simple: one content type, one prompt per page, no editing, no versioning.

## Non-Goals

- No human editing of the generated body. Regeneration fully overwrites.
- No versioning, rollback, or diff view.
- No semantic (pgvector) search across wiki pages. Plain SQL filtering only.
- No push notifications when generation completes — index and page polling only.
- No tags, categories, or hierarchical organisation.
- No SSE live-view of an in-progress generation (can be added later).
- No editing of title or topic after creation.

## User Flows

### Create
1. User clicks **Create wiki page** from `/wiki`.
2. Fills a short form: optional title, required topic (free-text prompt).
3. Submits. Page row is created with `status = "generating"`, background job kicks off using the user's Claude token.
4. User is redirected to `/wiki/[slug]`, which shows a "Generating…" placeholder and polls every ~5 seconds until the body is ready.

### Read
- Any authenticated user visits `/wiki` (index) or `/wiki/[slug]` (page view). All pages are visible to all users.

### Regenerate
1. On a page with `status = "ready"`, any user clicks **Regenerate**.
2. A modal shows the original topic read-only plus an optional *"Anything to focus on this time?"* free-text field.
3. Submit → `status` flips back to `"generating"`, `lastGeneratedById` updates to the current user, `lastGenerationPrompt` stores the extra field, background job starts using the current user's Claude token. Overwrites the body on completion.

### Delete (admin)
- Admin clicks **Delete** on a page → confirm modal → `DELETE /api/wiki/[slug]` → redirect to `/wiki`.
- Deletion while a generation is in flight is allowed. The runner does not check a kill flag; a late-arriving generation that writes to a deleted row is an acceptable edge case for v1 — the next cleanup pass or admin re-delete handles it.

## Data Model

New Prisma model only; no changes to existing models.

```prisma
model WikiPage {
  id                     String    @id @default(uuid())
  slug                   String    @unique
  title                  String
  topic                  String    @db.Text
  body                   String    @db.Text
  status                 String    // "generating" | "ready" | "failed"
  failureReason          String?

  // Attribution + token binding
  createdById            String
  createdBy              User      @relation("WikiPageCreator", fields: [createdById], references: [id])
  lastGeneratedById      String
  lastGeneratedBy        User      @relation("WikiPageLastGenerator", fields: [lastGeneratedById], references: [id])

  // Generation metadata
  lastGenerationPrompt   String?   @db.Text
  regenerationCount      Int       @default(0)
  generatedAt            DateTime?
  createdAt              DateTime  @default(now())
  updatedAt              DateTime  @updatedAt

  @@index([status])
  @@index([createdById])
}
```

### Field notes

- **`createdById`** — immutable. Whoever first created the page. Used for UI attribution ("Created by X"). Claude token used at initial creation.
- **`lastGeneratedById`** — mutable. Whoever last triggered generation or regeneration. Their encrypted Claude token is decrypted and used for the current job. Equals `createdById` at first creation, then updated on each regenerate.
- **`body`** — raw markdown as produced by Claude, post-sanitization. Empty string until first generation completes.
- **`status`** — string enum. `"generating"` until completion; `"ready"` on success; `"failed"` on error (including empty output, missing/expired Claude token, runtime errors).
- **`failureReason`** — short human-readable string. Examples: `"Empty response"`, `"Claude authentication required"`, `"Server restart interrupted generation"`.
- **`lastGenerationPrompt`** — the extra "focus" text from the most recent regeneration (or null for first generation).
- **`regenerationCount`** — incremented on every successful generation, including the first (so a ready page always has `regenerationCount >= 1`).
- **`generatedAt`** — timestamp of the current body. Null until first success.

### User relation additions

Two new back-relations on `User`:

```prisma
// on User model:
wikiPagesCreated        WikiPage[] @relation("WikiPageCreator")
wikiPagesLastGenerated  WikiPage[] @relation("WikiPageLastGenerator")
```

Users are not cascade-deleted from `WikiPage` — deleting a user (if ever supported) would require handling this separately. Out of scope for v1.

### Slug generation

Derived from title (or the first ~80 chars of topic if no title). Kebab-case, ASCII-only, max 80 chars. On collision, append a 6-char random suffix. Retry up to 3 times, then bail with 500.

## API Surface

All routes follow the existing auth pattern (`getServerSession(authOptions)`, 401 if no session). Admin-only routes additionally fetch the user and check `role === "admin"`, returning 403 otherwise.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/wiki` | user | Create page, start generation. |
| `GET` | `/api/wiki` | user | List pages, optional `?q=` filter and `?status=`. |
| `GET` | `/api/wiki/[slug]` | user | Read one page. |
| `POST` | `/api/wiki/[slug]/regenerate` | user | Trigger regeneration with optional extra prompt. |
| `DELETE` | `/api/wiki/[slug]` | admin | Delete a page. |

### `POST /api/wiki`

**Request body:**
```json
{ "topic": "string (1–2000 chars, required)", "title": "string (1–120 chars, optional)" }
```

**Behaviour:**
1. Validate body.
2. Check per-user concurrency cap — if the user currently has `>= 2` pages in `"generating"` status, return `429`.
3. Compute slug from title (or topic).
4. Create row with `status = "generating"`, `createdById = session.user.id`, `lastGeneratedById = session.user.id`, `lastGenerationPrompt = null`.
5. Fire-and-forget `wikiGenerator.run(pageId)`.
6. Return the new page row as JSON (`201`).

### `GET /api/wiki`

- Query params: `q` (ILIKE on title + topic), `status` (filter by status), default order `createdAt DESC`.
- Returns `{ pages: WikiPage[] }`, omitting `body` for list efficiency (only include on detail).

### `GET /api/wiki/[slug]`

- Returns the full `WikiPage`, including `body`, plus a minimal `createdBy` and `lastGeneratedBy` projection (id, name, email, image) for UI attribution.

### `POST /api/wiki/[slug]/regenerate`

**Request body:**
```json
{ "extraPrompt": "string (0–1000 chars, optional)" }
```

**Behaviour:**
1. Load page by slug. 404 if not found.
2. If `status === "generating"`, return `409 Conflict`.
3. Concurrency cap check (same rule as create).
4. Update row: `status = "generating"`, `lastGeneratedById = session.user.id`, `lastGenerationPrompt = extraPrompt ?? null`, `failureReason = null`.
5. Fire-and-forget `wikiGenerator.run(pageId)`.
6. Return the updated page row.

### `DELETE /api/wiki/[slug]`

- Admin only. Deletes the row. Returns `204`.

## Generation Runner

New file: `src/lib/wiki-generator.ts`. Single exported function:

```ts
export async function run(pageId: string): Promise<void>
```

### Steps

1. Load the `WikiPage` by id (with `lastGeneratedBy` included).
2. Decrypt `lastGeneratedBy`'s Claude token using the same helper the chat route uses. If decryption fails or the token is missing, mark the page `failed` with reason `"Claude authentication required"` and return.
3. Build the prompt (see "Prompt" below).
4. Acquire a Claude CLI session from `SessionManager` — same pool and concurrency limits as chat.
5. Send the prompt as a single user message. Accumulate streamed output via the existing `onTextDelta` pattern, applying the existing `stripSourceReferences` sanitizer to the accumulated buffer.
6. On `onClose`:
   - If accumulated body is at least 200 chars: update row with `body`, `status = "ready"`, `generatedAt = now()`, `regenerationCount = regenerationCount + 1`, `failureReason = null`.
   - If accumulated body is shorter than 200 chars: `status = "failed"`, `failureReason = "Empty response"`.
   - On any thrown/caught error during the session: `status = "failed"`, `failureReason` short description.
7. Release the session.

### Lifetime

- Runs on the Next.js server process — no separate worker or queue. Called from the POST handlers via `void wikiGenerator.run(pageId).catch(logError)`.
- Owned by `SessionManager` for concurrency, orphan cleanup, shutdown.

### Startup sweep

On server startup (same hook that runs existing startup tasks), execute:

```sql
UPDATE "WikiPage"
  SET status = 'failed', failureReason = 'Server restart interrupted generation'
  WHERE status = 'generating' AND updatedAt < now() - interval '15 minutes';
```

This catches pages left stranded by a restart. The 15-minute grace window prevents clobbering a legitimately long-running generation that briefly overlapped a restart.

### Prompt

Defined in `src/lib/config.ts` alongside existing prompts (e.g., `knowledgeToolsPrompt`, `responseReminder`):

```ts
export const wikiGenerationPrompt = `
You are writing an internal knowledge wiki page for non-technical support staff.
The audience does NOT read code.

Produce a single complete markdown article about the topic below.

Use short paragraphs and ## sections that match how a support person thinks
about the product. Reasonable section titles include:
- "What it does"
- "How a user uses it"
- "What support should know"
- "Common issues"

Hard rules:
- Do NOT include file paths, code, function names, API endpoints, or any
  developer-level references.
- Do NOT include the title as an # heading (the UI renders the title).
- Explain behaviour in plain English.
- Respond only in English.
- Output only the markdown article — no preamble, no postamble.
`;
```

The runner concatenates:

```
<wikiGenerationPrompt>

Topic:
<page.topic>

<if page.lastGenerationPrompt is non-empty>
Additional focus for this regeneration:
<page.lastGenerationPrompt>
</if>
```

The existing `stripSourceReferences` sanitizer acts as a safety net for any stray `file:line` references Claude produces despite the prompt.

## UI

All new pages under `src/app/wiki/`.

### `/wiki` — index
- Header with **Create wiki page** button.
- Client-side search input filtering the loaded list by title/topic.
- Cards per page: title, topic excerpt, status badge, "Created by" avatar, "Last generated" relative time, regeneration count.
- Cards in `generating` state show a spinner and link to the page (where progress polling happens).
- Poll `GET /api/wiki` every ~5s while any visible card is in `generating`; stop polling otherwise.

### `/wiki/new` — create
- Form with optional **Title**, required **Topic** (textarea).
- Client-side validation: topic non-empty, within length caps.
- Submit → `POST /api/wiki` → redirect to `/wiki/[slug]`.

### `/wiki/[slug]` — page view
- Title (h1), metadata row: *"Created by X · Last generated by Y · N regenerations · {relative time}"*.
- Body: rendered markdown using the same markdown renderer the chat already uses.
- Actions (top right):
  - **Regenerate** (any user) — modal with original topic (read-only) and optional extra-prompt textarea.
  - **Delete** (admin only) — confirm modal.
- If `status === "generating"`: body area replaced by a "Generating…" placeholder; Regenerate/Delete disabled; poll `GET /api/wiki/[slug]` every ~5s.
- If `status === "failed"`: show `failureReason` and a **Retry** button (same as regenerate with no extra prompt).

### Navigation
- Add a **Wiki** entry to the primary nav/sidebar alongside Chat / Dashboard / Knowledge.

## Edge Cases & Safeguards

- **Topic validation**: required, trimmed, 1–2000 chars.
- **Title validation**: optional, 1–120 chars if provided.
- **Extra-prompt validation** (regenerate): optional, 0–1000 chars if provided.
- **Empty/short output**: body < 200 chars → mark `failed`, reason `"Empty response"`.
- **Missing/expired Claude token**: decryption fails → mark `failed`, reason `"Claude authentication required"`, UI hint to re-link Claude in settings.
- **Slug collision**: retry up to 3 times with a 6-char random suffix, then 500.
- **Orphan `generating` rows** on server restart: startup sweep marks anything idle > 15 min as `failed`.
- **Concurrency cap**: per-user max 2 pages in `generating` at once; violations return 429.
- **Delete during generation**: allowed. The runner writes the body unconditionally on completion; if the row was deleted mid-flight, the write fails or resurrects a zombie row. Acceptable for v1 — admin re-delete clears it. Revisit if this becomes a real-world problem.
- **Per-turn sanitization**: reuse the chat pipeline's `stripSourceReferences` on the accumulated buffer.
- **Generation language**: prompt enforces English regardless of user locale (matches existing knowledge policy).

## Testing

Per project convention, no React component tests. Manual QA for all three pages.

Jest tests for:

- `src/lib/wiki-generator.ts`
  - Happy path: mocked Claude CLI produces output → row updated with body, status `ready`, counter incremented, `generatedAt` set.
  - Empty output path: output < threshold → status `failed`, reason `"Empty response"`.
  - Missing token path: `lastGeneratedBy` has no decryptable token → status `failed`, reason `"Claude authentication required"`.
  - Mid-run error path: session throws → status `failed`, reason stored, exception not propagated.
  - Startup sweep: rows in `generating` older than 15 min get marked `failed`; fresher rows are untouched.

- `src/app/api/wiki/route.ts` + `[slug]/route.ts` + `[slug]/regenerate/route.ts`
  - Auth: 401 without session.
  - Admin-only delete: 403 for non-admin users.
  - Body validation: 400 on missing/over-length topic.
  - Concurrency cap: 429 when a user already has 2 pages generating.
  - Slug generation: collision handling produces distinct slugs.
  - Regenerate against a `generating` page: 409.
  - Regenerate updates `lastGeneratedById` and `lastGenerationPrompt`.
  - Delete removes the row and returns 204.

## Open Questions

None. All design decisions confirmed during brainstorming:

- Creator on refresh: two fields (`createdById` immutable, `lastGeneratedById` mutable). Confirmed.
- Delete during generation: simple path, no kill flag. Confirmed.
- Admin edit of title after creation: not in v1. Confirmed.
- Regenerate availability: any user (not creator- or admin-only). Confirmed.

## Follow-ups (not in v1)

- SSE live-view of in-progress generation, removing the need for polling on the detail page.
- Push notification (in-app or email) when a page the current user created finishes generating.
- pgvector embeddings on `body` for semantic search across wiki pages.
- Editing of the body (would require resolving the conflict between regeneration and manual edits — approaches B/C/D from the brainstorming session).
- Tags or categories for organisation once the page count grows.
- Admin ability to rename a page title without regenerating.
