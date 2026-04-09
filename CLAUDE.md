@AGENTS.md

# Claude Agent — Codebase Q&A Platform

A Next.js 16 (App Router) application that lets non-technical support staff ask questions about a codebase via Claude Code CLI integration.

## Tech Stack

- **Framework**: Next.js 16.2.2 (App Router, TypeScript 5, React 19)
- **Database**: PostgreSQL 17+ with Prisma 7.6.0 (PrismaPg adapter) + pgvector
- **Auth**: NextAuth.js 4 (Google OAuth / test credentials), JWT sessions, role-based access
- **Styling**: Tailwind CSS 4 with @tailwindcss/typography
- **Testing**: Jest 30 + React Testing Library

## Quick Commands

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm test             # Run tests
npx prisma migrate dev   # Run migrations
npx prisma generate      # Regenerate Prisma client
```

## Directory Layout

See CLAUDE.md files in each subdirectory for detailed documentation:
- `src/` — Main source code
- `src/app/` — Pages and API routes
- `src/components/` — React client components
- `src/lib/` — Server utilities
- `prisma/` — Database schema and migrations
