# Codebase Q&A

A web app that lets team members ask questions about a codebase and get answers powered by Claude Code. Built for non-technical support staff — answers are in plain language, no code references.

## Features

- **Chat interface** with conversation history, sidebar, image uploads, and dark mode
- **Streaming responses** via Server-Sent Events from Claude Code CLI
- **Multi-turn conversations** using Claude's `--resume` flag
- **Per-user Claude authentication** — each user links their own Claude subscription by pasting a setup token
- **Self-learning knowledge base** — Claude saves insights to a shared Postgres + pgvector database, with semantic search via OpenRouter embeddings
- **Knowledge map** — interactive graph visualization showing how product concepts connect
- **Multi-repo support** — admins can register GitLab repositories; an OpenRouter-powered router picks the best repo for each question
- **Built-in feedback** — users submit feature requests and bug reports via a modal; admins manage feedback from the sidebar
- **Email notifications** — Resend integration sends users an email when their feedback is marked as done
- **Knowledge dashboard** — stats overview with semantic search across all knowledge entries
- **Maintenance mode** — flip one env var to show a "back soon" page to all users while deploying
- **Admin panel** — manage users, repositories, review flagged conversations, and feedback
- **Google OAuth** authentication for the app itself (or test-mode login for local dev)
- **Session management** — process pool with max concurrency and queuing

## Tech Stack

- Next.js 16 (App Router, TypeScript, React 19)
- Tailwind CSS 4
- PostgreSQL 17 + pgvector via Prisma ORM
- NextAuth.js (Google OAuth or test credentials)
- Claude Code CLI (`child_process.spawn`)
- MCP server for the knowledge tools
- OpenRouter (embeddings + repo routing)
- Resend (email notifications)
- Sentry (optional)
- react-force-graph-2d for the knowledge map

## Prerequisites

- Node.js 20+
- PostgreSQL 17+ with the `pgvector` extension (or Docker — the bundled compose uses the `pgvector/pgvector:pg17` image)
- An [OpenRouter](https://openrouter.ai) API key (used for embeddings and repo routing)
- Google OAuth credentials (from [Google Cloud Console](https://console.cloud.google.com/apis/credentials)) — or skip by enabling test mode
- A GitLab personal access token if you want to register GitLab repositories from the admin panel
- Each user needs a Claude subscription (Max, Pro, or Team) and [Claude Code](https://claude.ai/download) installed on their own machine to generate a setup token

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Required
DATABASE_URL="postgresql://claude_agent:claude_agent@localhost:5432/claude_agent"
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
NEXTAUTH_SECRET=generate-with-openssl-rand-base64-32
NEXTAUTH_URL=http://localhost:3000
TOKEN_ENCRYPTION_KEY=generate-with-openssl-rand-hex-32
KNOWLEDGE_API_SECRET=change-me-to-a-random-string
OPENROUTER_API_KEY=your-openrouter-api-key   # used for embeddings + repo routing

# Optional
UPLOAD_PATH=./uploads
MAX_CONCURRENT_SESSIONS=5        # max parallel Claude processes
SESSION_IDLE_TIMEOUT_MS=300000   # 5 minutes
CLAUDE_MAX_TURNS=25              # max tool-use turns per question

# Comma-separated LAN IPs/hosts to allow in Next.js dev mode (needed if testing
# the Windows installer download from a separate machine on the same LAN)
# ALLOWED_DEV_ORIGINS=192.168.1.42,10.0.0.5

# Legacy single-repo fallback (used only if no repos are configured in admin)
# REPO_PATH=/path/to/your/codebase

# Test mode — skip Google OAuth, use simple email login
# AUTH_TEST_MODE=true
# NEXT_PUBLIC_AUTH_TEST_MODE=true

# GitLab integration (multi-repo)
# GITLAB_TOKEN=glpat-your-gitlab-personal-access-token
# REPOS_DIR=/data/repos

# Email notifications (Resend) — sends users an email when their feedback is completed
# RESEND_API_KEY=re_your_api_key
# FROM_EMAIL=noreply@yourdomain.com
# REPLY_TO_EMAIL=support@yourdomain.com

# Sentry (optional)
# NEXT_PUBLIC_SENTRY_DSN=
```

To generate secrets:

```bash
openssl rand -base64 32   # for NEXTAUTH_SECRET
openssl rand -hex 32      # for TOKEN_ENCRYPTION_KEY
```

#### Quick start with test mode

If you don't have Google OAuth credentials, enable test mode for a simple login form:

```env
AUTH_TEST_MODE=true
NEXT_PUBLIC_AUTH_TEST_MODE=true
```

This shows a name/email form instead of Google sign-in. No OAuth setup needed — just fill in a name and email and click sign in. Remove these variables to switch back to Google OAuth.

### 3. Set up the database

Start PostgreSQL (via Docker or locally), then:

```bash
npx prisma generate
npx prisma migrate dev
```

`prisma generate` creates the Prisma client library. `prisma migrate dev` creates the database tables.

### 4. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Sign in and link your Claude account

1. Sign in with Google (or test mode credentials)
2. You'll see a prompt to **Link your Claude account** — click the button
3. The setup modal adapts to your OS:

   - **macOS** — a guided flow prompts you to open Terminal (`⌘+Space` → type `Terminal` → Enter) and paste a one-liner. The one-liner installs Claude Code and then runs `claude setup-token`, which opens a browser for you to authorize.
   - **Windows** — a **Download installer** button hands you `install-claude.bat`. Double-click it; if SmartScreen warns, click **More info** → **Run anyway**. The script installs Git for Windows (via `winget`) if missing, installs Claude Code, and runs `claude setup-token` — which opens a browser for you to authorize.

4. After authorizing, a long token string is printed in the terminal window. Copy it and paste it into the modal, then click **Link Account**.

Each user must link their own Claude account. Usage is billed to their own subscription. You can manage your linked account in **Settings** (accessible from the sidebar).

## Usage

### Asking questions

Type a question in the chat input. Claude Code will search the codebase and stream back an answer in plain language. You'll see progress indicators while Claude reads files and searches code.

### Conversations

- Previous conversations appear in the left sidebar
- Click a conversation to reload it
- Click "New Chat" to start fresh
- Hover over a conversation and click x to delete it

### Knowledge base

Claude automatically saves important discoveries to a shared knowledge base. These are loaded into every future session, so answers improve over time.

The knowledge base includes:
- **Corrections** — when a user corrects a wrong answer
- **Terminology** — what product-specific terms mean
- **Product insights** — how features actually work
- **Processes** — business workflows and rules
- **Developer insights** — architecture, code flow, and technical gotchas

### Knowledge map

Click "Knowledge Map" in the sidebar (or go to `/knowledge`) to see an interactive graph of all knowledge entries and how they connect through shared topics.

- Blue nodes = topics (shared tags)
- Green nodes = product insights
- Red nodes = corrections
- Purple nodes = terminology
- Orange nodes = processes
- Cyan nodes = developer insights

Click any node to see details.

## Project structure

```
src/
  app/
    api/
      admin/
        conversations/       # Admin: list/flag/justify flagged conversations
        feedback/            # Admin: list and update feedback status
        gitlab/              # Admin: search GitLab projects for repo registration
        repos/               # Admin: CRUD on registered repositories
        users/               # Admin: list users and manage roles
      auth/
        [...nextauth]/       # Google OAuth + credentials handler
        claude/               # Claude account: link, unlink, status
      chat/                   # POST: send message, SSE stream response
      conversations/          # GET: list, GET/DELETE: single conversation
      dashboard/              # GET: dashboard statistics
      feedback/               # POST: submit feedback (feature request or bug)
      flags/                  # POST: user flags a conversation for admin review
      knowledge/              # GET: list entries, POST: save entry
        graph/                # GET: graph data (nodes + links)
        search/               # POST: semantic search over entries
      maintenance-status/     # GET: check if maintenance mode is active
      upload/                 # POST: upload images; [id] to fetch/delete
    admin/
      repos/                  # Admin UI: registered repositories
    conversation/[id]/        # Dedicated conversation page
    dashboard/                # Knowledge dashboard with semantic search
    knowledge/                # Knowledge map page
    login/                    # Login page
    maintenance/              # Maintenance mode page (shown when MAINTENANCE_MODE=true)
    # Settings, Users, Flags, and Feedback are sidebar panels (no dedicated pages)
    global-error.tsx          # App-level error boundary (Sentry-aware)
    page.tsx                  # Main chat page
  components/
    ChatPage.tsx              # Top-level chat layout (sidebar + messages + input)
    ChatSidebar.tsx           # Conversation list + navigation + user info
    ChatMessages.tsx          # Message thread with streaming support
    ChatInput.tsx             # Auto-resizing textarea + attachments + send button
    LinkClaudeModal.tsx       # Step-by-step guide to link a Claude account
    MessageBubble.tsx         # Single message with markdown rendering
    KnowledgeGraph.tsx        # Force-directed graph visualization
    FeedbackModal.tsx         # Built-in feedback submission modal
    SettingsPanel.tsx         # User settings (Claude account linking)
    AdminUsersPanel.tsx       # Admin: user management
    AdminFlagsPanel.tsx       # Admin: flagged conversations
    AdminFeedbackPanel.tsx    # Admin: feedback management
    AdminUserConversationsPanel.tsx  # Admin: view user conversations
    DialogOverlay.tsx         # Reusable modal overlay
    ThemeProvider.tsx         # Dark/light mode provider
    Providers.tsx             # NextAuth SessionProvider wrapper
  lib/
    auth.ts                   # NextAuth config
    config.ts                 # App config + Claude system/knowledge prompts
    crypto.ts                 # AES-256-GCM encryption for stored tokens
    embed-text.ts             # Low-level embedding helper (single text → vector)
    embeddings.ts             # OpenRouter embeddings + semantic knowledge search
    email.ts                  # Resend email notifications
    knowledge-librarian.ts    # AI-powered knowledge curation via Claude Haiku
    claude-process-stream.ts  # Parse Claude CLI stream-JSON into SSE events
    prisma.ts                 # Prisma client singleton
    repo-manager.ts           # Clone, sync, and lock-down GitLab repositories
    repo-router.ts            # Route a question to the best matching repository
    sanitize-response.ts      # Strip code/paths from streamed answers
    session-manager.ts        # Claude CLI process pool + queuing
    upload.ts                 # Image upload helpers
  mcp/
    knowledge-server.mjs      # MCP server exposing search_knowledge + save_knowledge
    mcp-config.json           # MCP config passed to the Claude CLI
  proxy.ts                    # Route protection (JWT check)
prisma/
  schema.prisma               # Database schema
  init-pgvector.sql           # Enables the pgvector extension on first boot
  migrations/                 # Prisma migration history
scripts/
  backfill-embeddings.ts      # One-off: backfill embeddings for existing entries
  cleanup-uploads.ts          # Cron: delete orphaned/old uploads
  consolidate-knowledge.ts    # One-off: merge duplicate knowledge entries
  sync-repos.ts               # Cron: git pull all registered repos
  verify-knowledge.ts         # One-off: validate knowledge entry integrity
```

## Running tests

```bash
npm test
```

## Docker

### Running with Docker Compose

```bash
cp .env.example .env
# Edit .env — set DATABASE_URL to: postgresql://claude_agent:claude_agent@postgres:5432/claude_agent
docker compose build
docker compose up -d
```

This starts PostgreSQL and the app. The database is persisted in a Docker volume.

### Registering repositories

Once the app is running, sign in as an admin (the first user created is promoted to admin via seed — or edit the `role` column directly) and open **Admin → Repos**:

1. Set `GITLAB_TOKEN` in your `.env` (a personal access token with `read_api` + `read_repository` scope)
2. In the admin UI, search for a GitLab project and click **Register** — the app clones it to `REPOS_DIR` and enforces read-only permissions
3. To keep repos in sync, run `scripts/sync-repos.ts` on a schedule (e.g. via cron or a container with a cron runner):
   ```bash
   npx ts-node scripts/sync-repos.ts
   ```

The legacy `REPO_PATH` variable still works as a single-repo fallback if no repos are registered.

## Configuration

The system prompt can be customized in `src/lib/config.ts`. It controls how Claude answers questions — the default instructs Claude to:

- Answer in plain, non-technical language
- Never mention file paths, code, or technical terms
- Answer in the same language as the question
- Save important discoveries to the knowledge base

## Customizing for your team

The default `systemPrompt` and `knowledgeToolsPrompt` in `src/lib/config.ts` contain example references from the project this was originally built for (event management, HubSpot, Summit, badge printing). Before rolling this out inside your own team, rewrite those prompts to describe **your** product, terminology, and integrations. The suggested starter questions in `src/components/ChatMessages.tsx` and the example tags in `src/mcp/knowledge-server.mjs` use the same domain and should be updated too.

The app also assumes GitLab as the source host (see `src/app/api/admin/gitlab/search/route.ts` and `src/lib/repo-manager.ts`). If your repos live elsewhere, you'll need to adapt or replace the repo integration layer.
