# src/

This is the main source directory for a Next.js 16 (App Router) codebase Q&A application.

## Architecture

- `app/` — Next.js App Router pages and API routes
- `components/` — React client components (all `'use client'`)
- `lib/` — Server-side utilities (auth, prisma, crypto, embeddings, session management)
- `mcp/` — MCP server for Claude's knowledge tools
- `proxy.ts` — Dev proxy helper

## Key Patterns

- **Auth**: NextAuth.js with JWT strategy. All API routes use `getServerSession(authOptions)` for auth. User roles: `"user"` | `"admin"`.
- **Admin check**: Fetch the user from DB via email, check `currentUser.role !== 'admin'` and return 403.
- **Prisma client**: Always import from `@/lib/prisma` (singleton with PrismaPg adapter).
- **Streaming**: The chat API uses SSE (Server-Sent Events) with `ReadableStream` to stream Claude responses.
- **Session management**: Claude Code CLI processes are pooled via `SessionManager` with configurable concurrency.
- **Knowledge**: MCP server exposes `search_knowledge` and `save_knowledge` tools to Claude. Knowledge entries are auto-curated by the librarian.
