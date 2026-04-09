# src/app/

Next.js 16 App Router directory.

## Structure

- `api/` — Server-side API route handlers (REST endpoints)
- `admin/` — Admin-only pages (users, flags)
- `conversation/[id]/` — Individual conversation view
- `dashboard/` — Knowledge base dashboard with stats
- `knowledge/` — Knowledge graph visualization
- `login/` — Auth login page
- `settings/` — User settings (Claude account linking)
- `layout.tsx` — Root layout with Providers wrapper
- `page.tsx` — Home page (chat interface)

## API Route Patterns

All API routes follow this pattern:
1. Get session via `getServerSession(authOptions)`
2. Check `session?.user?.email` exists (401 if not)
3. For admin routes: fetch user from DB, check `role === 'admin'` (403 if not)
4. Use `NextResponse.json()` for JSON responses, `new Response()` for plain/streaming
