# src/lib/

Server-side utility modules.

## Modules

- `auth.ts` — NextAuth config. Google OAuth (prod) or Credentials (test mode via `AUTH_TEST_MODE`). Upserts users on sign-in. Adds `id` and `role` to session via callbacks.
- `prisma.ts` — Prisma client singleton with PrismaPg adapter. Import as `import { prisma } from '@/lib/prisma'`.
- `config.ts` — App config constants + Claude system prompt. Reads from env vars with defaults.
- `crypto.ts` — AES-256-GCM encrypt/decrypt for Claude OAuth tokens. Key from `TOKEN_ENCRYPTION_KEY` env var.
- `embeddings.ts` — OpenRouter text-embedding-3-large (1024 dims). `embedText()` for raw embeddings, `findRelevantEntries()` for semantic knowledge search with correction priority.
- `session-manager.ts` — Manages concurrent Claude Code CLI child processes. Queues requests when at capacity. Exports singleton `sessionManager`.
- `repo-manager.ts` — Clone, sync, and enforce read-only permissions on GitLab repositories.
- `repo-router.ts` — Route user questions to the best matching repository via OpenRouter.

## Usage

All API routes import from these modules. Never instantiate Prisma directly — always use the singleton from `prisma.ts`.
