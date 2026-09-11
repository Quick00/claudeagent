# src/mcp/

Stdio MCP server (`knowledge-server.mjs`) spawned by `session-manager.ts` for every Claude Code run. Plain JSON-RPC over stdio (`initialize`, `tools/list`, `tools/call`) — no MCP SDK dependency.

## Tools

- `save_knowledge(category, content, subject?, tags, based_on?)` — POSTs to `/api/knowledge` with `provenanceKey` (from env `PROVENANCE_KEY`, the triggering `Message.id`) and `basedOn` (from `based_on`). The route attaches the repo files Claude read in this save window as `KnowledgeSource` rows; `based_on` can only narrow that set, never add files Claude didn't read.
- `search_knowledge(query, limit?)` — POSTs to `/api/knowledge/search`; renders each hit with its freshness: verified (or, for a pinned entry, "verified, pinned business rule") / possibly outdated (with the changed files) / unverified.

## Env

`KNOWLEDGE_API_URL`, `KNOWLEDGE_SEARCH_URL`, `KNOWLEDGE_API_SECRET`, `PROVENANCE_KEY`. All set by `getMcpConfig()` in `src/lib/session-manager.ts` when it spawns the Claude CLI.
