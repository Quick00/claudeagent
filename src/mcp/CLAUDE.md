# src/mcp/

Stdio MCP server (`knowledge-server.mjs`) spawned by `session-manager.ts` for every Claude Code run. Plain JSON-RPC over stdio (`initialize`, `tools/list`, `tools/call`) — no MCP SDK dependency.

## Tools

- `save_knowledge(category, content, subject?, tags, based_on?)` — POSTs to `/api/knowledge` with `provenanceKey` (from env `PROVENANCE_KEY`, the triggering `Message.id`) and `basedOn` (from `based_on`). The route attaches the repo files Claude read in this save window as `KnowledgeSource` rows; `based_on` can only narrow that set, never add files Claude didn't read.
- `search_knowledge(query, limit?)` — POSTs to `/api/knowledge/search`; renders each hit with its freshness: verified (or, for a pinned entry, "verified, pinned business rule") / possibly outdated (with the changed files) / unverified.
- `resolve_verification(run_id, entry_id, outcome, content?, subject?, tags?)` — POSTs to `/api/knowledge/verify-result`. Only called by a tier 2 verification run (`startTier2()` in `src/lib/knowledge-verify-run.ts`), never by an ordinary chat session — the system prompt for that run is the only one that mentions this tool. `outcome` is `"confirmed"` | `"changed"` | `"retired"`; `content` is required when `outcome` is `"changed"`.

## Env

`KNOWLEDGE_API_URL`, `KNOWLEDGE_SEARCH_URL`, `KNOWLEDGE_VERIFY_URL`, `KNOWLEDGE_API_SECRET`, `PROVENANCE_KEY`. All set by `getMcpConfig()` in `src/lib/session-manager.ts` when it spawns the Claude CLI.
