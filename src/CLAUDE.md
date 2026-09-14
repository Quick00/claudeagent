# src/

This is the main source directory for a Next.js 16 (App Router) codebase Q&A application.

## Architecture

- `app/` — Next.js App Router pages and API routes
- `components/` — React client components (all `'use client'`)
- `lib/` — Server-side utilities (auth, prisma, crypto, embeddings, session management)
- `mcp/` — MCP server for Claude's knowledge tools
- `proxy.ts` — Dev proxy helper

## Key Patterns

- **Auth**: NextAuth.js with JWT strategy. User roles: `"user"` | `"admin"`. Account status: `"PENDING"` | `"APPROVED"` | `"REJECTED"`.
- **Route guards**: Use `requireApprovedUser()` / `requireAdminUser()` from `@/lib/api-auth` — they resolve the session user and return the right 401/404/403 response. Some older admin routes still call `getServerSession(authOptions)` directly.
- **Account approval**: Off by default. When the `requireUserApproval` setting is on, new sign-ups land as `PENDING` and see `/pending` until an admin approves them. Admins are emailed about every new account either way.
- **Prisma client**: Always import from `@/lib/prisma` (singleton with PrismaPg adapter).
- **Streaming**: The chat API uses SSE (Server-Sent Events) with `ReadableStream` to stream Claude responses.
- **Session management**: Claude Code CLI processes are pooled via `SessionManager` with configurable concurrency.
- **Knowledge**: MCP server exposes `search_knowledge` and `save_knowledge` tools to Claude. Entries carry provenance (`KnowledgeSource`: repo, file, git blob). Freshness is computed at read time by comparing blobs to HEAD, never stored. Pinned entries are human-owned and never auto-invalidate. A save attaches only the files Claude read since the previous save in that run; a `KnowledgeEntry` with no sources is labelled unverified rather than trusted. Nothing expires on a timer and a repo sync only records what changed (`RepoSync`) — it never flips a flag on an entry. Module-by-module detail is in `lib/CLAUDE.md`.
