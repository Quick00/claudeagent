# src/mcp/

Stdio MCP server (`knowledge-server.mjs`) spawned by `session-manager.ts` for every Claude Code run. Plain JSON-RPC over stdio (`initialize`, `tools/list`, `tools/call`) — no MCP SDK dependency.

## Tools

- `save_knowledge(category, content, subject?, tags, based_on?)` — POSTs to `/api/knowledge` with `provenanceKey` (from env `PROVENANCE_KEY`, the triggering `Message.id`) and `basedOn` (from `based_on`). The route attaches the repo files Claude read in this save window as `KnowledgeSource` rows; `based_on` can only narrow that set, never add files Claude didn't read.
- `search_knowledge(query, limit?)` — POSTs to `/api/knowledge/search`; renders each hit with its freshness: verified (or, for a pinned entry, "verified, pinned business rule") / possibly outdated (with the changed files) / unverified.
- `resolve_verification(run_id, entry_id, outcome, content?)` — POSTs to `/api/knowledge/verify-result`. Offered **only** when the server was spawned with `VERIFICATION_RUN_ID` set, i.e. by a tier 2 verification run (`startTier2()` in `src/lib/knowledge-verify-run.ts`): an ordinary chat session neither sees it in `tools/list` nor can call it. A call naming any other `run_id` is refused, and the id sent to the API is the one from the environment, never the model's. `outcome` is `"confirmed"` | `"changed"` | `"retired"`; `content` is required when `outcome` is `"changed"` and is queued as a `proposed_update` review for an admin rather than written to the page.
- During a verification run the reverse also holds: `save_knowledge` is withheld from `tools/list` and refused if called. A verifier reports through `resolve_verification`; it does not write pages.

## Env

`KNOWLEDGE_API_URL`, `KNOWLEDGE_SEARCH_URL`, `KNOWLEDGE_VERIFY_URL`, `KNOWLEDGE_API_SECRET`, `PROVENANCE_KEY`, `VERIFICATION_RUN_ID` (empty for a chat session; the run id for a tier 2 verification, which is what gates the tool set). All set by `getMcpConfig()` in `src/lib/session-manager.ts` when it spawns the Claude CLI.
