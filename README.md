# Codebase Q&A

A web app that lets team members ask questions about a codebase and get answers powered by Claude Code. Built for non-technical support staff — answers are in plain language, no code references.

## Features

- **Chat interface** with conversation history and sidebar
- **Streaming responses** via Server-Sent Events from Claude Code CLI
- **Multi-turn conversations** using Claude's `--resume` flag
- **Self-learning knowledge base** — Claude automatically saves insights to a shared database
- **Knowledge map** — interactive graph visualization showing how product concepts connect
- **Google OAuth** authentication
- **Session management** — process pool with max concurrency and queuing

## Tech Stack

- Next.js 16 (App Router, TypeScript)
- Tailwind CSS
- SQLite via Prisma ORM
- NextAuth.js (Google OAuth)
- Claude Code CLI (`child_process.spawn`)
- MCP server for knowledge tool
- react-force-graph-2d for knowledge visualization

## Prerequisites

- Node.js 20+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- Google OAuth credentials (from [Google Cloud Console](https://console.cloud.google.com/apis/credentials))

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
# Required
NEXTAUTH_SECRET=generate-with-openssl-rand-base64-32
NEXTAUTH_URL=http://localhost:3000
REPO_PATH=/path/to/your/codebase
KNOWLEDGE_API_SECRET=pick-a-random-secret

# Google OAuth (required unless using test mode)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Optional
MAX_CONCURRENT_SESSIONS=5        # max parallel Claude processes
SESSION_IDLE_TIMEOUT_MS=300000   # 5 minutes
CLAUDE_MAX_TURNS=25              # max tool-use turns per question

# Test mode — skip Google OAuth, use simple email login
# AUTH_TEST_MODE=true
# NEXT_PUBLIC_AUTH_TEST_MODE=true
```

To generate `NEXTAUTH_SECRET`:

```bash
openssl rand -base64 32
```

#### Quick start with test mode

If you don't have Google OAuth credentials, enable test mode for a simple login form:

```env
AUTH_TEST_MODE=true
NEXT_PUBLIC_AUTH_TEST_MODE=true
```

This shows a name/email form instead of Google sign-in. No OAuth setup needed — just fill in a name and email and click sign in. Remove these variables to switch back to Google OAuth.

### 3. Set up the database

```bash
npx prisma migrate dev
```

This creates a local SQLite database (`dev.db`) with the required tables.

### 4. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Sign in

Click "Sign in with Google". Your user account is created automatically on first login.

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

### Knowledge map

Click "Knowledge Map" in the sidebar (or go to `/knowledge`) to see an interactive graph of all knowledge entries and how they connect through shared topics.

- Blue nodes = topics (shared tags)
- Green nodes = product insights
- Red nodes = corrections
- Purple nodes = terminology
- Orange nodes = processes

Click any node to see details.

## Project structure

```
src/
  app/
    api/
      auth/[...nextauth]/  # Google OAuth handler
      chat/                 # POST: send message, SSE stream response
      conversations/        # GET: list, GET/DELETE: single conversation
      knowledge/            # GET: list entries, POST: save entry
        graph/              # GET: graph data (nodes + links)
    knowledge/              # Knowledge map page
    login/                  # Login page
    page.tsx                # Main chat page
  components/
    ChatSidebar.tsx         # Conversation list + new chat + user info
    ChatMessages.tsx        # Message thread with streaming support
    ChatInput.tsx           # Auto-resizing textarea + send button
    MessageBubble.tsx       # Single message with markdown rendering
    KnowledgeGraph.tsx      # Force-directed graph visualization
    Providers.tsx           # NextAuth SessionProvider wrapper
  lib/
    auth.ts                 # NextAuth config
    config.ts               # Environment variable access with defaults
    prisma.ts               # Prisma client singleton
    session-manager.ts      # Claude CLI process pool + queuing
  mcp/
    knowledge-server.mjs    # MCP server exposing save_knowledge tool
  middleware.ts             # Route protection (JWT check)
prisma/
  schema.prisma             # Database schema
```

## Running tests

```bash
npm test
```

## Configuration

The system prompt can be customized in `src/lib/config.ts`. It controls how Claude answers questions — the default instructs Claude to:

- Answer in plain, non-technical language
- Never mention file paths, code, or technical terms
- Answer in the same language as the question
- Save important discoveries to the knowledge base
