# src/lib/

Server-side utility modules.

## Modules

- `auth.ts` — NextAuth config. Google OAuth (prod) or Credentials (test mode via `AUTH_TEST_MODE`). Both providers route account creation through `sign-in.ts`. Adds `id`, `role`, and `status` to session via callbacks.
- `sign-in.ts` — `applySignIn()`: creates or refreshes the account behind a sign-in, applies the approval setting, blocks rejected accounts, and emails admins about new accounts.
- `user-approval.ts` — Pure approval logic. `USER_STATUS` (`PENDING`/`APPROVED`/`REJECTED`), `resolveSignIn()` decision function, `isUserStatus()` guard. No DB or auth imports, so it stays free of import cycles.
- `api-auth.ts` — `requireApprovedUser()` and `requireAdminUser()`: resolve the session user and return a ready-made 401/404/403 `Response` when they fail. Use these in route handlers instead of hand-rolling the session + role checks.
- `settings.ts` — Admin-toggleable settings stored in the `AppSetting` key/value table. `getRequireUserApproval()` / `setRequireUserApproval()`. Defaults to off.
- `prisma.ts` — Prisma client singleton with PrismaPg adapter. Import as `import { prisma } from '@/lib/prisma'`.
- `config.ts` — App config constants + Claude system prompt. Reads from env vars with defaults.
- `crypto.ts` — AES-256-GCM encrypt/decrypt for Claude OAuth tokens. Key from `TOKEN_ENCRYPTION_KEY` env var.
- `embed-text.ts` — Low-level embedding helper (single text to vector via OpenRouter).
- `embeddings.ts` — OpenRouter text-embedding-3-large (1024 dims). `embedText()` for raw embeddings, `findRelevantEntries()` for semantic knowledge search with correction priority.
- `email.ts` — Email sending via Resend API. Sends notifications for flag responses, completed feedback, and new accounts (`sendNewAccountNotification()` mails every `role: 'admin'` user, one message each).
- `knowledge-librarian.ts` — Uses Claude Haiku (via OpenRouter) to curate and deduplicate knowledge entries automatically.
- `claude-process-stream.ts` — Attaches to Claude Code CLI subprocess and streams responses via SSE. Parses JSON output into `conversation_created`, `text`, `tool_use`, `done`, `error` events.
- `session-manager.ts` — Manages concurrent Claude Code CLI child processes. Queues requests when at capacity. Exports singleton `sessionManager`.
- `repo-manager.ts` — Clone, sync, and enforce read-only permissions on GitLab repositories.
- `sanitize-response.ts` — Strips source file references from Claude responses for security/privacy.
- `upload.ts` — File upload handling. Stores files to `UPLOAD_PATH`, validates MIME types and size limits.

## Usage

All API routes import from these modules. Never instantiate Prisma directly — always use the singleton from `prisma.ts`.
