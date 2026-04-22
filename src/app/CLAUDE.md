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
- `install/` — Windows installer download route (`install-claude-windows.bat`)
- `layout.tsx` — Root layout with Providers wrapper
- `page.tsx` — Home page (chat interface)

Admin panels for users, flags, feedback, and settings are sidebar modals in `src/components/`, not separate pages.

## API Route Patterns

All API routes follow this pattern:
1. Get session via `getServerSession(authOptions)`
2. Check `session?.user?.email` exists (401 if not)
3. For admin routes: fetch user from DB, check `role === 'admin'` (403 if not)
4. Use `NextResponse.json()` for JSON responses, `new Response()` for plain/streaming
