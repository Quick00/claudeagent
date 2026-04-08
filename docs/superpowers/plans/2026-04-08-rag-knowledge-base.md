# RAG Knowledge Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the full knowledge dump in chat prompts with semantic search using pgvector and Anthropic Voyager embeddings, returning only the top 10 most relevant entries per question.

**Architecture:** Knowledge entries get embedded at write time via the Anthropic Voyager API and stored as 1024-dim vectors in Postgres via pgvector. On each chat message, the user's question is embedded and compared via cosine similarity. All correction entries are always included; remaining slots filled by best semantic matches.

**Tech Stack:** pgvector, Anthropic Voyager API (`voyage-3`), Prisma raw SQL for vector queries, PostgreSQL 17.

---

### File Structure

| File | Action | Responsibility |
|---|---|---|
| `prisma/schema.prisma` | Modify | Add embedding field (as `Unsupported("vector(1024)")`) |
| `prisma/migrations/YYYYMMDD_add_embeddings/migration.sql` | Create | Enable pgvector, add column + index |
| `src/lib/embeddings.ts` | Create | `embedText()` and `findRelevantEntries()` |
| `src/app/api/knowledge/route.ts` | Modify | Embed content on save |
| `src/app/api/chat/route.ts` | Modify | Replace full dump with `findRelevantEntries()` |
| `scripts/backfill-embeddings.ts` | Create | One-time backfill for existing entries |
| `.env.example` | Modify | Add `VOYAGE_API_KEY` |
| `docker-compose.yml` | Modify | Add pgvector init script for Postgres |

---

### Task 1: Enable pgvector in Postgres

**Files:**
- Modify: `docker-compose.yml`
- Create: `prisma/migrations/20260408000000_add_pgvector_embeddings/migration.sql`
- Modify: `prisma/schema.prisma:41-48`

- [ ] **Step 1: Add pgvector init to docker-compose.yml**

The `postgres:17-alpine` image includes pgvector but it needs to be enabled. Add a volume-mounted init script:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: claude_agent
      POSTGRES_PASSWORD: claude_agent
      POSTGRES_DB: claude_agent
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./prisma/init-pgvector.sql:/docker-entrypoint-initdb.d/init-pgvector.sql
    restart: unless-stopped
```

- [ ] **Step 2: Create the init SQL file**

Create `prisma/init-pgvector.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

- [ ] **Step 3: Create the Prisma migration**

Create `prisma/migrations/20260408000000_add_pgvector_embeddings/migration.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE "KnowledgeEntry" ADD COLUMN "embedding" vector(1024);
CREATE INDEX "KnowledgeEntry_embedding_idx" ON "KnowledgeEntry" USING hnsw (embedding vector_cosine_ops);
```

Note: Using HNSW index instead of IVFFlat — it performs better on small datasets and doesn't require a minimum row count.

- [ ] **Step 4: Update Prisma schema**

In `prisma/schema.prisma`, update the `KnowledgeEntry` model:

```prisma
model KnowledgeEntry {
  id        String                          @id @default(uuid())
  category  String
  content   String
  tags      String                          @default("")
  source    String?
  embedding Unsupported("vector(1024)")?
  createdAt DateTime                        @default(now())
}
```

- [ ] **Step 5: Mark migration as applied**

Run: `npx prisma migrate resolve --applied 20260408000000_add_pgvector_embeddings`

Then regenerate the client:

Run: `npx prisma generate`

- [ ] **Step 6: Commit**

```bash
git add prisma/ docker-compose.yml
git commit -m "feat: add pgvector extension and embedding column to KnowledgeEntry"
```

---

### Task 2: Create the embeddings utility module

**Files:**
- Create: `src/lib/embeddings.ts`

- [ ] **Step 1: Add VOYAGE_API_KEY to .env.example**

Append to `.env.example`:

```
VOYAGE_API_KEY=your-voyage-api-key
```

- [ ] **Step 2: Create src/lib/embeddings.ts**

```typescript
import { prisma } from '@/lib/prisma';

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const EMBEDDING_MODEL = 'voyage-3';

export async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error('VOYAGE_API_KEY is not set');
  }

  const res = await fetch(VOYAGE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: [text],
      model: EMBEDDING_MODEL,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage API error (${res.status}): ${body}`);
  }

  const data = await res.json();
  return data.data[0].embedding;
}

interface KnowledgeEntryResult {
  id: string;
  category: string;
  content: string;
  tags: string;
  source: string | null;
  createdAt: Date;
}

export async function findRelevantEntries(
  query: string,
  limit: number = 10,
): Promise<KnowledgeEntryResult[]> {
  // Always include all corrections
  const corrections: KnowledgeEntryResult[] = await prisma.$queryRaw`
    SELECT id, category, content, tags, source, "createdAt"
    FROM "KnowledgeEntry"
    WHERE category = 'correction'
  `;

  const remainingSlots = limit - corrections.length;
  if (remainingSlots <= 0) {
    return corrections.slice(0, limit);
  }

  const queryEmbedding = await embedText(query);
  const vectorStr = `[${queryEmbedding.join(',')}]`;

  const semanticResults: KnowledgeEntryResult[] = await prisma.$queryRaw`
    SELECT id, category, content, tags, source, "createdAt"
    FROM "KnowledgeEntry"
    WHERE embedding IS NOT NULL
    AND category != 'correction'
    ORDER BY embedding <=> ${vectorStr}::vector
    LIMIT ${remainingSlots}
  `;

  return [...corrections, ...semanticResults];
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/embeddings.ts .env.example
git commit -m "feat: add embeddings utility with Voyage API and pgvector search"
```

---

### Task 3: Embed knowledge entries on save

**Files:**
- Modify: `src/app/api/knowledge/route.ts:43-45`

- [ ] **Step 1: Update the POST handler to embed on save**

In `src/app/api/knowledge/route.ts`, add the import at the top:

```typescript
import { embedText } from '@/lib/embeddings';
```

Then replace the `prisma.knowledgeEntry.create` call (lines 43-45):

```typescript
  // Old:
  const entry = await prisma.knowledgeEntry.create({
    data: { category, content, tags: tags || '', source },
  });
```

With:

```typescript
  let embedding: number[] | null = null;
  try {
    embedding = await embedText(content);
  } catch (err) {
    console.error('[knowledge] Failed to generate embedding:', (err as Error).message);
  }

  const entry = await prisma.knowledgeEntry.create({
    data: { category, content, tags: tags || '', source },
  });

  if (embedding) {
    const vectorStr = `[${embedding.join(',')}]`;
    await prisma.$executeRaw`
      UPDATE "KnowledgeEntry"
      SET embedding = ${vectorStr}::vector
      WHERE id = ${entry.id}
    `;
  }
```

Note: We use raw SQL for the embedding update because Prisma doesn't support the `vector` type natively. The entry is created first (so it exists even if embedding fails), then updated with the vector.

- [ ] **Step 2: Commit**

```bash
git add src/app/api/knowledge/route.ts
git commit -m "feat: generate embedding when saving knowledge entries"
```

---

### Task 4: Replace full knowledge dump with semantic search in chat

**Files:**
- Modify: `src/app/api/chat/route.ts:80-107`

- [ ] **Step 1: Update the chat route**

In `src/app/api/chat/route.ts`, add the import at the top:

```typescript
import { findRelevantEntries } from '@/lib/embeddings';
```

Then replace lines 80-107 (the knowledge fetching and prompt building):

```typescript
  // Old:
  const knowledgeEntries = await prisma.knowledgeEntry.findMany({
    orderBy: { createdAt: 'asc' },
  });
```

With:

```typescript
  let knowledgeEntries: { id: string; category: string; content: string; tags: string; source: string | null; createdAt: Date }[] = [];
  try {
    knowledgeEntries = await findRelevantEntries(message, 10);
  } catch (err) {
    console.error('[chat] Failed to fetch relevant entries, falling back to all:', (err as Error).message);
    knowledgeEntries = await prisma.knowledgeEntry.findMany({
      orderBy: { createdAt: 'asc' },
    });
  }
```

The rest of the prompt building logic (lines 84-107 — grouping by category, building `knowledgeBlock`) stays exactly the same. It just now operates on the filtered set of entries.

- [ ] **Step 2: Commit**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat: use semantic search for knowledge retrieval in chat"
```

---

### Task 5: Create backfill script for existing entries

**Files:**
- Create: `scripts/backfill-embeddings.ts`

- [ ] **Step 1: Create the scripts directory and backfill script**

Create `scripts/backfill-embeddings.ts`:

```typescript
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const EMBEDDING_MODEL = 'voyage-3';

async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error('VOYAGE_API_KEY is not set');
  }

  const res = await fetch(VOYAGE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: [text],
      model: EMBEDDING_MODEL,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage API error (${res.status}): ${body}`);
  }

  const data = await res.json();
  return data.data[0].embedding;
}

async function main() {
  const entries: { id: string; content: string }[] = await prisma.$queryRaw`
    SELECT id, content FROM "KnowledgeEntry" WHERE embedding IS NULL
  `;

  console.log(`Found ${entries.length} entries without embeddings`);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    try {
      const embedding = await embedText(entry.content);
      const vectorStr = `[${embedding.join(',')}]`;
      await prisma.$executeRaw`
        UPDATE "KnowledgeEntry"
        SET embedding = ${vectorStr}::vector
        WHERE id = ${entry.id}
      `;
      console.log(`[${i + 1}/${entries.length}] Embedded: ${entry.content.slice(0, 60)}...`);
    } catch (err) {
      console.error(`[${i + 1}/${entries.length}] FAILED: ${(err as Error).message}`);
    }
  }

  console.log('Done');
  await prisma.$disconnect();
}

main();
```

- [ ] **Step 2: Verify it runs**

Run: `npx tsx scripts/backfill-embeddings.ts`

Expected: Logs showing each entry being embedded, or "Found 0 entries without embeddings" if the DB is empty.

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-embeddings.ts
git commit -m "feat: add backfill script for existing knowledge entry embeddings"
```

---

### Task 6: Final integration test

- [ ] **Step 1: Run the migration against your database**

```bash
npx prisma migrate resolve --applied 20260408000000_add_pgvector_embeddings
```

If running against a fresh database instead:

```bash
npx prisma migrate deploy
```

- [ ] **Step 2: Run the backfill script**

```bash
npx tsx scripts/backfill-embeddings.ts
```

- [ ] **Step 3: Test the full flow**

1. Start the dev server: `npm run dev`
2. Send a chat message — verify logs show semantic search happening
3. Save a knowledge entry via the MCP tool — verify the embedding is generated
4. Send a related question — verify the entry appears in the context

- [ ] **Step 4: Verify fallback works**

Temporarily unset `VOYAGE_API_KEY` and send a message. The chat route should fall back to fetching all entries with a console warning.

- [ ] **Step 5: Final commit if any adjustments needed**

```bash
git add -A
git commit -m "chore: final adjustments from integration testing"
```
