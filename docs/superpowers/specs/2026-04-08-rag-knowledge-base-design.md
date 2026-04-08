# RAG-Based Knowledge Retrieval

**Date:** 2026-04-08
**Status:** Approved

## Problem

The current knowledge system dumps all entries into every chat prompt regardless of relevance. This wastes tokens, doesn't scale, and provides no ranking of which knowledge is most useful for a given question.

## Solution

Replace the full knowledge dump with semantic search using embeddings. On each chat message, embed the user's question and retrieve only the top 10 most relevant entries using cosine similarity via pgvector.

## Design Decisions

- **Embedding model:** Anthropic Voyager (`voyage-3`, 1024 dimensions)
- **Vector store:** pgvector extension on existing Postgres
- **Embed timing:** At write time (knowledge save) and at query time (user question)
- **Retrieval limit:** Top 10 entries per query
- **Corrections exception:** All `correction` category entries are always included regardless of similarity score. Remaining slots (up to 10 total) filled by most relevant entries from other categories.

## Database Changes

### Enable pgvector

Add the pgvector extension to Postgres. This requires the extension to be available in the Docker image — `postgres:17-alpine` supports it via `CREATE EXTENSION vector`.

### Schema Migration

Add an `embedding` column to the `KnowledgeEntry` table:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE "KnowledgeEntry" ADD COLUMN "embedding" vector(1024);
CREATE INDEX ON "KnowledgeEntry" USING ivfflat (embedding vector_cosine_ops);
```

The column is nullable to support existing entries before backfill.

## New Module: `src/lib/embeddings.ts`

Two functions:

### `embedText(text: string): Promise<number[]>`

- Calls the Anthropic Voyager embeddings API
- Input: plain text string
- Output: 1024-dimensional float array
- Auth: `VOYAGE_API_KEY` env var

### `findRelevantEntries(query: string, limit: number): Promise<KnowledgeEntry[]>`

- Calls `embedText(query)` to get the question embedding
- Fetches all `correction` category entries (always included)
- Queries pgvector for remaining slots using cosine similarity:
  ```sql
  SELECT * FROM "KnowledgeEntry"
  WHERE embedding IS NOT NULL
  AND category != 'correction'
  ORDER BY embedding <=> $queryVector
  LIMIT $remainingSlots
  ```
- Returns combined results (corrections + top semantic matches)

## Modified Write Flow

**File:** `src/app/api/knowledge/route.ts` (POST handler)

After validation and duplicate check:

1. Call `embedText(content)` to generate embedding
2. Include embedding in the `prisma.knowledgeEntry.create()` call
3. Response unchanged — transparent to MCP server

## Modified Read Flow

**File:** `src/app/api/chat/route.ts`

Replace:
```typescript
const knowledgeEntries = await prisma.knowledgeEntry.findMany({
  orderBy: { createdAt: 'asc' },
});
```

With:
```typescript
const knowledgeEntries = await findRelevantEntries(message, 10);
```

The grouping-by-category and system prompt injection logic remains the same — it just operates on 10 entries instead of all of them.

## Backfill Script

**File:** `scripts/backfill-embeddings.ts`

One-time script to embed existing entries:

1. Fetch all entries where `embedding IS NULL`
2. For each entry, call `embedText(content)`
3. Update the row with the embedding
4. Log progress

Run manually after migration: `npx tsx scripts/backfill-embeddings.ts`

## Environment Changes

Add to `.env.example`:
```
VOYAGE_API_KEY=your-api-key-here
```

## What Does NOT Change

- MCP knowledge server (`src/mcp/knowledge-server.mjs`) — unchanged
- Knowledge graph API and component — unchanged
- Dashboard — unchanged
- Frontend — unchanged
- `save_knowledge` tool schema — unchanged
- Knowledge categories and validation — unchanged

## Component Overview

```
User Question
    |
    v
embedText(question) --> 1024-dim vector
    |
    v
pgvector cosine similarity query
    |
    v
Top 10 entries (all corrections + best semantic matches)
    |
    v
Grouped by category, injected into system prompt
    |
    v
Claude CLI process (unchanged)
```
