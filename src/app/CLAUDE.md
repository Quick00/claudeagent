# src/app/

Next.js 16 App Router directory.

## Structure

- `api/` — Server-side API route handlers (REST endpoints)
- `admin/conversations/` — Every conversation across all users, with search and an owner filter. Rows link into `/chat/[id]`, which is already where an admin reads and replies — this page is a way in, not a second viewer.
- `admin/repos/` — Admin repository management page
- `admin/knowledge/` — Admin attention page: stale, unverified, verified, pinned, reviews, syncs; edit / pin / unpin / retire / verify. Pinned entries have their own tab because they are always fresh and so appear in no other one; without it, pinning would hide an entry from the panel for good.
- `conversation/[id]/` — Individual conversation view
- `dashboard/` — Knowledge dashboard with stats and semantic search
- `knowledge/` — Knowledge graph visualization
- `login/` — Auth login page
- `maintenance/` — Maintenance mode page (shown when `MAINTENANCE_MODE=true`)
- `pending/` — Waiting-for-approval page for unapproved accounts. Polls `/api/account-status` and reloads into the app once approved.
- `install/` — Windows installer download route (`install-claude-windows.bat`)
- `layout.tsx` — Root layout with Providers wrapper
- `page.tsx` — Home page (chat interface)

Every admin area is a page under `(shell)/admin/`, each a one-line wrapper around a panel component in `src/components/admin/`.

## API Route Patterns

Routes that serve app data use the guards from `@/lib/api-auth`:

```ts
const auth = await requireApprovedUser(); // or requireAdminUser()
if (!auth.ok) return auth.response;
const user = auth.user;
```

They return 401 (no session), 404 (no account), or 403 (unapproved / not admin). Some
older admin routes still hand-roll `getServerSession(authOptions)` plus a role check —
prefer the guards for new code.

Use `NextResponse.json()` for JSON responses, `new Response()` for plain/streaming.

`/api/account-status` deliberately skips the approval guard so the pending page can poll it.

The knowledge attention page is backed by four `requireAdminUser()`-guarded routes: `GET /api/admin/knowledge` (reconciles verification runs stranded at `pending` by a restart, then returns `buildAttention()`) and `POST /api/admin/knowledge` (creates a pinned entry), `PATCH /api/admin/knowledge/[id]` (admin field edits, including retiring — `{status: 'retired'}` — and pin/unpin — `kind`), `POST /api/admin/knowledge/[id]/verify` (`{tier: 1 | 2}`, tier 2 needs the admin's own linked Claude token; both tiers answer 409 rather than 500 on failure, and tier 2 holds the connection for the length of the run — it refuses a second concurrent run on the same entry so a proxy timeout cannot become a second paid run), and `PATCH /api/admin/knowledge/reviews/[id]` (`{action: 'accept' | 'dismiss'}`). These all sit behind the session-based admin guard, unlike `/api/knowledge/verify-result` (see `src/mcp/CLAUDE.md`), which is called by the MCP server rather than a signed-in admin and checks the `KNOWLEDGE_API_SECRET` bearer token instead.
