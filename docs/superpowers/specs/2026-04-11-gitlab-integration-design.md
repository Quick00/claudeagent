# GitLab Integration — Multi-Repo Support

## Overview

Expand the Q&A platform from a single-repo deployment to supporting multiple GitLab.com repositories. An admin adds repos via a settings UI, repos are cloned and periodically synced, and incoming questions are automatically routed to the correct repo by a lightweight LLM call before spinning up Claude CLI.

## Data Model

### New: `Repository`

| Field | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| name | String | Display name, e.g. "Billing Service" |
| description | Text | Admin-written explanation for routing context |
| gitlabProjectId | Int | GitLab project ID for API calls |
| gitlabUrl | String | Full GitLab repo URL |
| defaultBranch | String | e.g. "main" |
| localPath | String | Disk path, e.g. `/data/repos/12345/` |
| lastPulledAt | DateTime? | Last successful git pull |
| active | Boolean (default true) | Soft disable without deleting |
| createdAt | DateTime | |
| updatedAt | DateTime | |

### Modified: `Conversation`

- Add optional `repositoryId` FK → `Repository`
- Set on first message via routing; reused on resume

### Modified: `KnowledgeEntry`

- Add optional `repositoryId` FK → `Repository`
- null = global/legacy entry
- New entries saved by Claude get the current conversation's repo attributed

## GitLab API Integration

### Authentication

- Single Personal Access Token (PAT) stored as `GITLAB_TOKEN` env var
- Used server-side only for searching projects and cloning repos
- Scopes needed: `read_api`, `read_repository`

### Admin UI — `/admin/repos`

- **Search**: Text input queries GitLab API (`GET /api/v4/projects?search=...&membership=true`)
- **Search results**: Project name, namespace/group, description, last activity
- **Add flow**: "Add" button opens form for admin to write the routing description/explanation
- **Repo table**: Name, description, status (active/cloning/error), last pulled, active toggle
- **Edit**: Update description
- **Remove**: Soft-deactivate (toggle) or hard delete with confirmation

### API Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/repos` | List all repos |
| POST | `/api/admin/repos` | Add repo (triggers async clone) |
| PATCH | `/api/admin/repos/[id]` | Update description, toggle active |
| DELETE | `/api/admin/repos/[id]` | Remove repo + local clone |
| GET | `/api/admin/gitlab/search?q=...` | Proxy search to GitLab API |

### Cloning

- On add: clone to `REPOS_DIR/<gitlab-project-id>/`
- HTTPS clone: `git clone https://oauth2:<GITLAB_TOKEN>@gitlab.com/<namespace>/<project>.git`
- Async — repo status shows "cloning..." until complete
- `REPOS_DIR` env var (e.g. `/data/repos/`)

### Sync Script

- Standalone script: `scripts/sync-repos.ts`
- Runs on cron (e.g. every 10 minutes)
- Iterates all active repos, runs `git fetch && git reset --hard origin/<defaultBranch>`
- Updates `lastPulledAt` in database on success
- Can be invoked manually: `npx tsx scripts/sync-repos.ts`

## Question Routing

### Flow

1. User sends question via `/api/chat`
2. Fetch all active repos (id, name, description) from DB
3. If only 1 active repo: skip routing, use it directly
4. Call OpenRouter with a fast/cheap model (e.g. `openai/gpt-4o-mini`)
5. Prompt includes repo list (id + name + description) and the user's question
6. Model returns the best-matching repo ID
7. Look up `localPath`, pass to Claude CLI via `--add-dir`
8. Store `repositoryId` on the Conversation

### Routing Prompt

```
You are a routing assistant. Given a user question and a list of code repositories with descriptions, pick the single best matching repository. Return ONLY the repository ID, nothing else.

Repositories:
{{#each repos}}
- id: {{id}} | name: "{{name}}" | description: "{{description}}"
{{/each}}

Question: "{{question}}"
```

### Edge Cases

- **1 active repo**: Skip routing, use directly
- **Routing API failure**: Return error asking user to try again
- **No repos configured**: Fall back to `REPO_PATH` env var if set (backwards compat), otherwise error telling admin to configure repos
- **Continuing conversation (resume)**: Skip routing, use `repositoryId` already on Conversation

## Chat Flow Changes

### `/api/chat/route.ts`

1. After auth, before Claude spawn: fetch active repos, run routing if needed
2. Replace `REPO_PATH` with `repo.localPath` for `--add-dir`
3. Save `repositoryId` on Conversation
4. On resume: read `repositoryId` from existing Conversation, skip routing

### `session-manager.ts`

- `startSession()` and `resumeSession()` accept `repoPath` parameter instead of reading `REPO_PATH` from env

### System Prompt (`config.ts`)

- Include repo context: "You are answering questions about the **{name}** codebase: {description}"
- Include `lastPulledAt` timestamp for code freshness awareness
- Add staleness instruction: "If a knowledge entry contradicts what you see in the current code, trust the code — the entry may be outdated. Use save_knowledge to save an updated correction."

### Knowledge Context

- `findRelevantEntries()` query unchanged (shared knowledge base)
- Results include `repository.name` so system prompt shows provenance per entry: `[from: Billing Service]` or `[global]`
- When Claude saves knowledge via MCP, the current conversation's `repositoryId` is passed and stored on the entry

### MCP Knowledge Server

- `save_knowledge` receives optional `repositoryId` parameter
- Stored on `KnowledgeEntry` for attribution

## Removals

- **`/api/webhook/gitlab/route.ts`** — deleted entirely
- **`REPO_PATH` env var** — no longer primary mechanism; kept as optional fallback during migration only
- **Git pull logic** tied to old single-repo webhook — replaced by sync script
- **`GITLAB_WEBHOOK_SECRET` env var** — no longer needed

## New Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GITLAB_TOKEN` | Yes (for feature) | GitLab.com PAT with `read_api` + `read_repository` |
| `REPOS_DIR` | Yes (for feature) | Directory for cloned repos, e.g. `/data/repos/` |

## Knowledge Staleness Strategy

No automatic invalidation. Instead, Claude self-heals the knowledge base:

1. Knowledge entries are timestamped and attributed to their source repo
2. System prompt includes repo `lastPulledAt` so Claude knows code freshness
3. System prompt instructs: trust current code over knowledge entries when they conflict
4. Claude saves updated corrections via `save_knowledge`, naturally superseding stale entries over time
