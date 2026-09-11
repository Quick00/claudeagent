# src/lib/

Server-side utility modules.

## Modules

- `auth.ts` — NextAuth config. Google OAuth (prod) or Credentials (test mode via `AUTH_TEST_MODE`). Both providers route account creation through `sign-in.ts`. Adds `id`, `role`, and `status` to session via callbacks.
- `sign-in.ts` — `applySignIn()`: creates or refreshes the account behind a sign-in, applies the approval setting, blocks rejected accounts, and emails admins about new accounts.
- `user-approval.ts` — Pure approval logic. `USER_STATUS` (`PENDING`/`APPROVED`/`REJECTED`), `resolveSignIn()` decision function, `isUserStatus()` guard. No DB or auth imports, so it stays free of import cycles.
- `api-auth.ts` — `requireApprovedUser()` and `requireAdminUser()`: resolve the session user and return a ready-made 401/404/403 `Response` when they fail. Use these in route handlers instead of hand-rolling the session + role checks.
- `settings.ts` — Admin-toggleable settings stored in the `AppSetting` key/value table. `getRequireUserApproval()` / `setRequireUserApproval()`. Defaults to off.
- `prisma.ts` — Prisma client singleton with PrismaPg adapter. Import as `import { prisma } from '@/lib/prisma'`.
- `config.ts` — App config constants + Claude system prompt. Reads from env vars with defaults. Also holds the knowledge tunables (`knowledgeRetrievalThreshold`, `knowledgeMaxSourcesPerSave`, `knowledgeIgnoreSegments`, `knowledgeIgnoreBasenames`) and `claudeDisallowedTools`.
- `crypto.ts` — AES-256-GCM encrypt/decrypt for Claude OAuth tokens. Key from `TOKEN_ENCRYPTION_KEY` env var.
- `embed-text.ts` — Low-level embedding helper (single text to vector via OpenRouter).
- `embeddings.ts` — OpenRouter text-embedding-3-large (1024 dims). `embedText()` for raw embeddings, `findSimilarPages()` (librarian candidates, threshold `KNOWLEDGE_SIMILARITY_THRESHOLD`), `findRelevantEntries()` (retrieval, threshold `KNOWLEDGE_RETRIEVAL_THRESHOLD`, excludes retired, returns `similarity`).
- `email.ts` — Email sending via Resend API. Sends notifications for flag responses, completed feedback, and new accounts (`sendNewAccountNotification()` mails every `role: 'admin'` user, one message each).
- `knowledge-context.ts` — `retrieveKnowledge()` labels each retrieved entry with computed freshness and bumps hit counters on the entries that survive dedupe (the discarded duplicates are never shown, so they earn no hit); `formatKnowledgeBlock()` renders the VERIFIED / POSSIBLY OUTDATED / UNVERIFIED system-prompt groups; `formatKnowledgeDelta()` is the compact form prepended to follow-up messages (resume does not re-send the system prompt).
- `knowledge-save.ts` — `saveKnowledge()`: resolves provenance sources from the collector, embeds, asks the librarian, creates or merges. A merge refreshes only the sources read in that run and bumps `correctionCount` when the page was fresh. The provenance window is consumed only when something was actually written, so a librarian `skip` leaves those reads for the next save.
- `knowledge-librarian.ts` — Haiku via OpenRouter decides create / update / skip. Candidates carry freshness; stale claims must be dropped or rewritten on update.
- `knowledge-freshness.ts` — Pure `computeFreshness()`: pinned → fresh; no sources → unverified; any source blob ≠ HEAD → stale with `changedPaths`.
- `knowledge-repos.ts` — `loadActiveHeadTrees()` maps every active repo's `gitlabProjectId` to its HEAD tree.
- `knowledge-invalidation.ts` — Pure `parseNameStatus()` parses `git diff --name-status -M -z` output; `diffCommits()` runs it between two SHAs; `recordRepoSync()` rewrites renamed source paths, counts entries that would go stale, and writes a `RepoSync` row. Called by `scripts/sync-repos.ts` and the admin repos route. No `@/` imports, so `tsx` can load it directly.
- `provenance-collector.ts` — `provenanceCollector` singleton recording the repo files Claude `Read` during a run, keyed by the triggering `Message.id`. `snapshot()` returns reads since the last `markSave()`, deduped and capped at `knowledgeMaxSourcesPerSave` — with no fallback to the whole run, so a second save that read nothing new honestly reports zero sources instead of inheriting the first save's. Pure helpers: `isIgnoredPath()` (drops translations, lockfiles, vendored code, CHANGELOGs), `toRepoRelative()`, `narrowByBasedOn()` (a `based_on` hint can only narrow the captured set, never add files Claude didn't read).
- `repo-tree.ts` — Pure `parseLsTree()` parses `git ls-tree -r -z HEAD` output. `getHeadTree()` wraps it, cached per repo path until `getHeadSha()` (`git rev-parse HEAD`) reports a new commit, and concurrent misses share one `ls-tree`. Both git calls are async (`execFile`, argument array, no shell) because they run on the chat request path, where `execFileSync` would block the event loop for every other user.
- `claude-process-stream.ts` — `attachClaudeProcess()` parses the Claude CLI `stream-json` protocol from a child process's stdout and dispatches to `ClaudeEventHandlers`: `onSessionId`, `onTextDelta`, `onToolUse`, `onToolUseInput` (the complete tool input, from `assistant` events — partial stream deltas carry none; feeds the provenance collector), `onAuthFailed`, `onRateLimit`, `onResult`, `onClose`, `onProcessError`. `createSseResponse()` builds the SSE `Response` around an idempotent `SseSink`.
- `session-manager.ts` — Manages concurrent Claude Code CLI child processes, queuing requests when at capacity. `getMcpConfig()` passes `provenanceKey` (the triggering `Message.id`) to the MCP server as `PROVENANCE_KEY`, and both `startSession()`/`resumeSession()` pass `--disallowedTools` (`config.claudeDisallowedTools`, from `CLAUDE_DISALLOWED_TOOLS`) so file reads stay observable and repos stay read-only. Exports singleton `sessionManager`.
- `repo-manager.ts` — Clone, sync (`syncRepo()` returns `{ fromSha, toSha }`), and enforce read-only permissions on GitLab repositories.
- `sanitize-response.ts` — Strips source file references from Claude responses for security/privacy.
- `upload.ts` — File upload handling. Stores files to `UPLOAD_PATH`, validates MIME types and size limits.

## Usage

All API routes import from these modules. Never instantiate Prisma directly — always use the singleton from `prisma.ts`.
