# src/lib/

Server-side utility modules.

## Modules

- `auth.ts` — NextAuth config. Google OAuth (prod) or Credentials (test mode via `AUTH_TEST_MODE`). Upserts users on sign-in. Adds `id` and `role` to session via callbacks.
- `prisma.ts` — Prisma client singleton with PrismaPg adapter. Import as `import { prisma } from '@/lib/prisma'`.
- `config.ts` — App config constants + Claude system prompt. Reads from env vars with defaults.
- `crypto.ts` — AES-256-GCM encrypt/decrypt for Claude OAuth tokens. Key from `TOKEN_ENCRYPTION_KEY` env var.
- `embed-text.ts` — Low-level embedding helper (single text to vector via OpenRouter).
- `embeddings.ts` — OpenRouter text-embedding-3-large (1024 dims). `embedText()` for raw embeddings, `findRelevantEntries()` for semantic knowledge search with correction priority.
- `email.ts` — Email sending via Resend API. Sends notifications for flag responses and completed feedback.
- `knowledge-librarian.ts` — Uses Claude Haiku (via OpenRouter) to curate and deduplicate knowledge entries automatically.
- `claude-process-stream.ts` — Attaches to Claude Code CLI subprocess and streams responses via SSE. Parses JSON output into `conversation_created`, `text`, `tool_use`, `done`, `error` events.
- `session-manager.ts` — Manages concurrent Claude Code CLI child processes. Queues requests when at capacity. Exports singleton `sessionManager`.
- `repo-manager.ts` — Clone, sync, and enforce read-only permissions on GitLab repositories.
- `repo-router.ts` — Route user questions to the best matching repository via OpenRouter.
- `sanitize-response.ts` — Strips source file references from Claude responses for security/privacy.
- `upload.ts` — File upload handling. Stores files to `UPLOAD_PATH`, validates MIME types and size limits.

## Usage

All API routes import from these modules. Never instantiate Prisma directly — always use the singleton from `prisma.ts`.
