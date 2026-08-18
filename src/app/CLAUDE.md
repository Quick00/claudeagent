# src/app/

Next.js 16 App Router directory.

## Structure

- `api/` — Server-side API route handlers (REST endpoints)
- `admin/repos/` — Admin repository management page
- `conversation/[id]/` — Individual conversation view
- `dashboard/` — Knowledge dashboard with stats and semantic search
- `knowledge/` — Knowledge graph visualization
- `login/` — Auth login page
- `maintenance/` — Maintenance mode page (shown when `MAINTENANCE_MODE=true`)
- `pending/` — Waiting-for-approval page for unapproved accounts. Polls `/api/account-status` and reloads into the app once approved.
- `install/` — Windows installer download route (`install-claude-windows.bat`)
- `layout.tsx` — Root layout with Providers wrapper
- `page.tsx` — Home page (chat interface)

Admin panels for users, flags, feedback, and settings are sidebar modals in `src/components/`, not separate pages.

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
