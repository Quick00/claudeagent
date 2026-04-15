# Wiki Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship user-triggered, Claude-authored wiki pages for non-technical support staff, aimed at building a curated long-form knowledge library layered on top of the existing codebase Q&A pipeline.

**Architecture:** A new `WikiPage` Prisma model stores title/topic/body and two user foreign keys (immutable `createdById`, mutable `lastGeneratedById` whose Claude token is used for generation). A new `src/lib/wiki-generator.ts` runs fire-and-forget on the Next.js server process, reusing `SessionManager`, `attachClaudeProcess`, `routeQuestion`, and `stripSourceReferences` from the chat pipeline. Four REST routes under `/api/wiki` handle CRUD + regenerate. Three pages under `/wiki` provide index, create, and detail UIs that poll for status updates.

**Tech Stack:** Next.js 16 App Router, Prisma 7, PostgreSQL, NextAuth, existing Claude Code CLI session manager, `react-markdown` + `remark-gfm` (already used by `MessageBubble`), Jest 30.

**Spec:** `docs/superpowers/specs/2026-04-15-wiki-pages-design.md`

**Branch:** `feature/wiki-pages` (already created off `main`; spec already committed as `a6a2a6e`).

**Execution notes:**
- Per user preference, do **not** run a reviewer subagent between tasks. One code review at the end of the branch covers the whole thing.
- Per user preference, do **not** write React component tests. API and lib code get Jest tests; UI gets manual QA only.

---

## Task 1: Add `WikiPage` Prisma model + migration

**Files:**
- Modify: `prisma/schema.prisma` (add `WikiPage` model; add two back-relations to `User`)
- Create: `prisma/migrations/20260415120000_add_wiki_pages/migration.sql`

- [ ] **Step 1: Add the `WikiPage` model and user back-relations**

In `prisma/schema.prisma`, append the `WikiPage` model at the end of the file (after `Repository`):

```prisma
model WikiPage {
  id                   String    @id @default(uuid())
  slug                 String    @unique
  title                String
  topic                String    @db.Text
  body                 String    @db.Text
  status               String    // "generating" | "ready" | "failed"
  failureReason        String?

  createdById          String
  createdBy            User      @relation("WikiPageCreator", fields: [createdById], references: [id])
  lastGeneratedById    String
  lastGeneratedBy      User      @relation("WikiPageLastGenerator", fields: [lastGeneratedById], references: [id])

  lastGenerationPrompt String?   @db.Text
  regenerationCount    Int       @default(0)
  generatedAt          DateTime?
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  @@index([status])
  @@index([createdById])
}
```

Then add two relation lines to the existing `User` model block (the file currently lists back-relations around `prisma/schema.prisma:18-21`):

```prisma
  wikiPagesCreated        WikiPage[] @relation("WikiPageCreator")
  wikiPagesLastGenerated  WikiPage[] @relation("WikiPageLastGenerator")
```

- [ ] **Step 2: Generate the migration**

Run: `npx prisma migrate dev --name add_wiki_pages`
Expected: a new directory `prisma/migrations/20260415120000_add_wiki_pages/` containing a `migration.sql` that creates the `WikiPage` table, the two indexes, and the two foreign keys to `User`.

If you prefer to author the SQL by hand (to pin the timestamp), create `prisma/migrations/20260415120000_add_wiki_pages/migration.sql`:

```sql
CREATE TABLE "WikiPage" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "failureReason" TEXT,
    "createdById" TEXT NOT NULL,
    "lastGeneratedById" TEXT NOT NULL,
    "lastGenerationPrompt" TEXT,
    "regenerationCount" INTEGER NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WikiPage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WikiPage_slug_key" ON "WikiPage"("slug");
CREATE INDEX "WikiPage_status_idx" ON "WikiPage"("status");
CREATE INDEX "WikiPage_createdById_idx" ON "WikiPage"("createdById");

ALTER TABLE "WikiPage"
  ADD CONSTRAINT "WikiPage_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WikiPage"
  ADD CONSTRAINT "WikiPage_lastGeneratedById_fkey"
  FOREIGN KEY ("lastGeneratedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
```

Then run: `npx prisma migrate dev --name add_wiki_pages`
Expected: migration applies cleanly; `npx prisma generate` runs automatically.

- [ ] **Step 3: Verify the Prisma client picks up the new model**

Run: `npx tsc --noEmit`
Expected: passes. If it fails, run `npx prisma generate` and retry.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260415120000_add_wiki_pages
git commit -m "feat(wiki): add WikiPage Prisma model and migration"
```

---

## Task 2: Slug utility

**Files:**
- Create: `src/lib/wiki-slug.ts`
- Test: `__tests__/lib/wiki-slug.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/wiki-slug.test.ts`:

```ts
import { slugify, withSuffix } from '@/lib/wiki-slug';

describe('slugify', () => {
  it('lowercases and kebab-cases plain text', () => {
    expect(slugify('Authentication Flow')).toBe('authentication-flow');
  });

  it('strips non-ASCII and punctuation', () => {
    expect(slugify('Héllo — World!')).toBe('hello-world');
  });

  it('collapses runs of whitespace and dashes', () => {
    expect(slugify('a  b---c')).toBe('a-b-c');
  });

  it('trims leading and trailing dashes', () => {
    expect(slugify('---foo---')).toBe('foo');
  });

  it('truncates to 80 chars', () => {
    const input = 'a'.repeat(200);
    expect(slugify(input)).toHaveLength(80);
  });

  it('falls back to "page" when input yields an empty slug', () => {
    expect(slugify('!!!')).toBe('page');
  });
});

describe('withSuffix', () => {
  it('appends a 6-char random suffix', () => {
    const s = withSuffix('authentication-flow');
    expect(s).toMatch(/^authentication-flow-[a-z0-9]{6}$/);
  });

  it('keeps total length within 80 chars by trimming the base', () => {
    const base = 'a'.repeat(80);
    const s = withSuffix(base);
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s).toMatch(/-[a-z0-9]{6}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/wiki-slug.test.ts`
Expected: FAIL — module `@/lib/wiki-slug` not found.

- [ ] **Step 3: Implement the utility**

Create `src/lib/wiki-slug.ts`:

```ts
const MAX_SLUG_LEN = 80;
const SUFFIX_LEN = 6;

export function slugify(input: string): string {
  const normalized = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LEN)
    .replace(/-+$/, '');

  return normalized || 'page';
}

export function withSuffix(slug: string): string {
  const suffix = Math.random().toString(36).slice(2, 2 + SUFFIX_LEN).padEnd(SUFFIX_LEN, '0');
  const maxBase = MAX_SLUG_LEN - SUFFIX_LEN - 1;
  const base = slug.length > maxBase ? slug.slice(0, maxBase).replace(/-+$/, '') : slug;
  return `${base}-${suffix}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/wiki-slug.test.ts`
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/wiki-slug.ts __tests__/lib/wiki-slug.test.ts
git commit -m "feat(wiki): add slug utility"
```

---

## Task 3: Add `wikiGenerationPrompt` to config

**Files:**
- Modify: `src/lib/config.ts` (add a new key inside the `config` object)
- Test: `__tests__/lib/config.test.ts` (extend existing file)

- [ ] **Step 1: Add the prompt to `config`**

Open `src/lib/config.ts`. The `config` object currently ends with `knowledgeToolsPrompt: \`...\`` on line 61 followed by `} as const;` on line 62. Add a new key after `knowledgeToolsPrompt` but before the closing brace:

```ts
  wikiGenerationPrompt: `You are writing an internal knowledge wiki page for non-technical support staff.
The audience does NOT read code.

Produce a single complete markdown article about the topic below.

Use short paragraphs and ## sections that match how a support person thinks about the product.
Reasonable section titles include:
- "What it does"
- "How a user uses it"
- "What support should know"
- "Common issues"

Hard rules:
- Do NOT include file paths, code, function names, API endpoints, or any developer-level references.
- Do NOT include the title as an # heading (the UI renders the title).
- Explain behaviour in plain English.
- Respond only in English.
- Output only the markdown article — no preamble, no postamble.`,
```

- [ ] **Step 2: Add a config test**

Open `__tests__/lib/config.test.ts` and add a new `describe` block at the bottom:

```ts
describe('config.wikiGenerationPrompt', () => {
  it('is a non-empty string', () => {
    expect(typeof config.wikiGenerationPrompt).toBe('string');
    expect(config.wikiGenerationPrompt.length).toBeGreaterThan(100);
  });

  it('tells Claude not to include file paths or code', () => {
    expect(config.wikiGenerationPrompt).toMatch(/file paths/i);
    expect(config.wikiGenerationPrompt).toMatch(/code/i);
  });

  it('tells Claude to respond in English only', () => {
    expect(config.wikiGenerationPrompt).toMatch(/english/i);
  });
});
```

If `config` is not already imported, add `import { config } from '@/lib/config';` at the top of the file.

- [ ] **Step 3: Run tests**

Run: `npx jest __tests__/lib/config.test.ts`
Expected: all tests PASS, including the three new ones.

- [ ] **Step 4: Commit**

```bash
git add src/lib/config.ts __tests__/lib/config.test.ts
git commit -m "feat(wiki): add wikiGenerationPrompt to config"
```

---

## Task 4: `wiki-generator` lib — happy path

**Files:**
- Create: `src/lib/wiki-generator.ts`
- Test: `__tests__/lib/wiki-generator.test.ts`

- [ ] **Step 1: Write the happy-path test**

Create `__tests__/lib/wiki-generator.test.ts`:

```ts
import { runWikiGeneration, sweepOrphanGeneratingPages } from '@/lib/wiki-generator';
import { prisma } from '@/lib/prisma';
import { sessionManager } from '@/lib/session-manager';
import { attachClaudeProcess } from '@/lib/claude-process-stream';
import { EventEmitter } from 'events';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    wikiPage: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    repository: {
      findMany: jest.fn(),
    },
  },
}));
jest.mock('@/lib/session-manager', () => ({
  sessionManager: { startSession: jest.fn() },
}));
jest.mock('@/lib/crypto', () => ({
  decrypt: (s: string) => `dec(${s})`,
}));
jest.mock('@/lib/repo-router', () => ({
  routeQuestion: jest.fn().mockResolvedValue('repo-1'),
}));
jest.mock('@/lib/claude-process-stream', () => ({
  attachClaudeProcess: jest.fn(),
}));

function makeFakeChildProcess() {
  const proc = new EventEmitter() as EventEmitter & { kill: jest.Mock };
  proc.kill = jest.fn();
  return proc;
}

describe('runWikiGeneration — happy path', () => {
  beforeEach(() => jest.clearAllMocks());

  it('streams output and marks page ready', async () => {
    (prisma.wikiPage.findUnique as jest.Mock).mockResolvedValue({
      id: 'page-1',
      topic: 'Authentication flow',
      lastGenerationPrompt: null,
      regenerationCount: 0,
      lastGeneratedById: 'user-1',
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'user-1',
      claudeToken: 'encrypted-token',
    });
    (prisma.repository.findMany as jest.Mock).mockResolvedValue([
      { id: 'repo-1', name: 'r1', description: '', localPath: '/tmp/r1', lastPulledAt: null },
    ]);

    const proc = makeFakeChildProcess();
    (sessionManager.startSession as jest.Mock).mockReturnValue(proc);

    // Capture handlers passed to attachClaudeProcess and drive them manually.
    let capturedHandlers: { onTextDelta?: (s: string) => void; onClose?: (c: number | null) => void } = {};
    (attachClaudeProcess as jest.Mock).mockImplementation((_p, handlers) => {
      capturedHandlers = handlers;
    });

    const promise = runWikiGeneration('page-1');

    // Simulate Claude streaming a long article.
    capturedHandlers.onTextDelta!('# '.padEnd(300, 'x'));
    capturedHandlers.onClose!(0);

    await promise;

    expect(prisma.wikiPage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'page-1' },
        data: expect.objectContaining({
          status: 'ready',
          body: expect.any(String),
          regenerationCount: 1,
          generatedAt: expect.any(Date),
          failureReason: null,
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/wiki-generator.test.ts`
Expected: FAIL — module `@/lib/wiki-generator` not found.

- [ ] **Step 3: Implement the generator (happy path only)**

Create `src/lib/wiki-generator.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { sessionManager } from '@/lib/session-manager';
import { attachClaudeProcess } from '@/lib/claude-process-stream';
import { decrypt } from '@/lib/crypto';
import { routeQuestion } from '@/lib/repo-router';
import { config } from '@/lib/config';
import { stripSourceReferences } from '@/lib/sanitize-response';
import { randomUUID } from 'crypto';

const MIN_BODY_CHARS = 200;

export async function runWikiGeneration(pageId: string): Promise<void> {
  const page = await prisma.wikiPage.findUnique({ where: { id: pageId } });
  if (!page) return;

  const user = await prisma.user.findUnique({ where: { id: page.lastGeneratedById } });
  if (!user?.claudeToken) {
    await markFailed(pageId, 'Claude authentication required');
    return;
  }

  let claudeToken: string;
  try {
    claudeToken = decrypt(user.claudeToken);
  } catch {
    await markFailed(pageId, 'Claude authentication required');
    return;
  }

  const repos = await prisma.repository.findMany({
    where: { active: true },
    select: { id: true, name: true, description: true, localPath: true, lastPulledAt: true },
  });

  let repoPath = config.repoPath;
  let repositoryId: string | undefined;
  if (repos.length > 0) {
    try {
      const chosenId = await routeQuestion(page.topic, repos);
      const chosen = repos.find((r) => r.id === chosenId);
      if (chosen) {
        repoPath = chosen.localPath;
        repositoryId = chosen.id;
      }
    } catch (err) {
      console.error('[wiki-generator] routing failed, using fallback:', (err as Error).message);
    }
  }

  if (!repoPath) {
    await markFailed(pageId, 'No repositories configured');
    return;
  }

  const systemPrompt = config.wikiGenerationPrompt;
  let message = `Topic:\n${page.topic}`;
  if (page.lastGenerationPrompt) {
    message += `\n\nAdditional focus for this regeneration:\n${page.lastGenerationPrompt}`;
  }

  const requestId = `wiki-${pageId}-${randomUUID().slice(0, 8)}`;
  let accumulated = '';
  let failed = false;

  try {
    const procOrPromise = sessionManager.startSession(
      requestId,
      message,
      systemPrompt,
      claudeToken,
      user.id,
      repoPath,
      repositoryId,
    );
    const proc = procOrPromise instanceof Promise ? await procOrPromise : procOrPromise;

    await new Promise<void>((resolve) => {
      attachClaudeProcess(proc, {
        onTextDelta: (delta) => {
          accumulated += delta;
        },
        onClose: () => resolve(),
      });
    });
  } catch (err) {
    failed = true;
    await markFailed(pageId, `Generation error: ${(err as Error).message.slice(0, 200)}`);
  }

  if (failed) return;

  const body = stripSourceReferences(accumulated).trim();
  if (body.length < MIN_BODY_CHARS) {
    await markFailed(pageId, 'Empty response');
    return;
  }

  await prisma.wikiPage.update({
    where: { id: pageId },
    data: {
      body,
      status: 'ready',
      generatedAt: new Date(),
      regenerationCount: { increment: 1 },
      failureReason: null,
    },
  });
}

async function markFailed(pageId: string, reason: string): Promise<void> {
  await prisma.wikiPage.update({
    where: { id: pageId },
    data: { status: 'failed', failureReason: reason },
  });
}

export async function sweepOrphanGeneratingPages(): Promise<void> {
  const cutoff = new Date(Date.now() - 15 * 60 * 1000);
  await prisma.wikiPage.updateMany({
    where: { status: 'generating', updatedAt: { lt: cutoff } },
    data: { status: 'failed', failureReason: 'Server restart interrupted generation' },
  });
}
```

- [ ] **Step 4: Run the happy-path test**

Run: `npx jest __tests__/lib/wiki-generator.test.ts`
Expected: the happy-path test PASSES.

- [ ] **Step 5: Commit**

```bash
git add src/lib/wiki-generator.ts __tests__/lib/wiki-generator.test.ts
git commit -m "feat(wiki): add wiki generator runner (happy path)"
```

---

## Task 5: `wiki-generator` — error paths

**Files:**
- Modify: `__tests__/lib/wiki-generator.test.ts`

- [ ] **Step 1: Add tests for the three error paths**

Append to `__tests__/lib/wiki-generator.test.ts`:

```ts
describe('runWikiGeneration — missing token', () => {
  beforeEach(() => jest.clearAllMocks());

  it('marks failed with "Claude authentication required" when user has no token', async () => {
    (prisma.wikiPage.findUnique as jest.Mock).mockResolvedValue({
      id: 'page-1',
      topic: 't',
      lastGenerationPrompt: null,
      regenerationCount: 0,
      lastGeneratedById: 'user-1',
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user-1', claudeToken: null });

    await runWikiGeneration('page-1');

    expect(prisma.wikiPage.update).toHaveBeenCalledWith({
      where: { id: 'page-1' },
      data: { status: 'failed', failureReason: 'Claude authentication required' },
    });
    expect(sessionManager.startSession).not.toHaveBeenCalled();
  });
});

describe('runWikiGeneration — empty output', () => {
  beforeEach(() => jest.clearAllMocks());

  it('marks failed with "Empty response" when body is too short', async () => {
    (prisma.wikiPage.findUnique as jest.Mock).mockResolvedValue({
      id: 'page-1',
      topic: 't',
      lastGenerationPrompt: null,
      regenerationCount: 0,
      lastGeneratedById: 'user-1',
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user-1', claudeToken: 'enc' });
    (prisma.repository.findMany as jest.Mock).mockResolvedValue([
      { id: 'repo-1', name: 'r', description: '', localPath: '/tmp/r', lastPulledAt: null },
    ]);

    const proc = makeFakeChildProcess();
    (sessionManager.startSession as jest.Mock).mockReturnValue(proc);

    let handlers: { onTextDelta?: (s: string) => void; onClose?: (c: number | null) => void } = {};
    (attachClaudeProcess as jest.Mock).mockImplementation((_p, h) => {
      handlers = h;
    });

    const promise = runWikiGeneration('page-1');
    handlers.onTextDelta!('too short');
    handlers.onClose!(0);
    await promise;

    expect(prisma.wikiPage.update).toHaveBeenCalledWith({
      where: { id: 'page-1' },
      data: { status: 'failed', failureReason: 'Empty response' },
    });
  });
});

describe('runWikiGeneration — session throws', () => {
  beforeEach(() => jest.clearAllMocks());

  it('marks failed with "Generation error" prefix when startSession throws', async () => {
    (prisma.wikiPage.findUnique as jest.Mock).mockResolvedValue({
      id: 'page-1',
      topic: 't',
      lastGenerationPrompt: null,
      regenerationCount: 0,
      lastGeneratedById: 'user-1',
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user-1', claudeToken: 'enc' });
    (prisma.repository.findMany as jest.Mock).mockResolvedValue([
      { id: 'repo-1', name: 'r', description: '', localPath: '/tmp/r', lastPulledAt: null },
    ]);
    (sessionManager.startSession as jest.Mock).mockImplementation(() => {
      throw new Error('spawn failed');
    });

    await expect(runWikiGeneration('page-1')).resolves.toBeUndefined();

    expect(prisma.wikiPage.update).toHaveBeenCalledWith({
      where: { id: 'page-1' },
      data: expect.objectContaining({
        status: 'failed',
        failureReason: expect.stringContaining('Generation error'),
      }),
    });
  });
});

describe('sweepOrphanGeneratingPages', () => {
  beforeEach(() => jest.clearAllMocks());

  it('marks pages stuck in generating older than 15 min as failed', async () => {
    await sweepOrphanGeneratingPages();

    expect(prisma.wikiPage.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'generating',
        updatedAt: { lt: expect.any(Date) },
      },
      data: {
        status: 'failed',
        failureReason: 'Server restart interrupted generation',
      },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx jest __tests__/lib/wiki-generator.test.ts`
Expected: all five tests PASS (1 happy + 3 error + 1 sweep).

- [ ] **Step 3: Commit**

```bash
git add __tests__/lib/wiki-generator.test.ts
git commit -m "test(wiki): cover generator error paths and startup sweep"
```

---

## Task 6: Hook startup sweep into `instrumentation.ts`

**Files:**
- Modify: `src/instrumentation.ts`

- [ ] **Step 1: Call the sweep once on server start**

Current `src/instrumentation.ts`:

```ts
import * as Sentry from "@sentry/nextjs";
import type { Instrumentation } from "next";

export async function register() {
  // existing body
}

export const onRequestError: Instrumentation.onRequestError = (...args) => {
  // existing body
};
```

Modify `register` to also run the wiki sweep (nodejs runtime only, swallowing errors so a DB hiccup doesn't kill startup):

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
    try {
      const { sweepOrphanGeneratingPages } = await import('@/lib/wiki-generator');
      await sweepOrphanGeneratingPages();
    } catch (err) {
      console.error('[startup] wiki sweep failed:', (err as Error).message);
    }
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}
```

Note: match whatever the existing `register()` body already does for Sentry imports — add only the `try { sweepOrphanGeneratingPages } catch` block inside the `nodejs` branch. Read `src/instrumentation.ts` before editing to confirm the current structure and keep it intact.

- [ ] **Step 2: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: passes.

```bash
git add src/instrumentation.ts
git commit -m "feat(wiki): sweep orphan generating pages on server start"
```

---

## Task 7: `POST /api/wiki` — create page

**Files:**
- Create: `src/app/api/wiki/route.ts`
- Test: `__tests__/api/wiki-create.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/wiki-create.test.ts`:

```ts
import { POST, GET } from '@/app/api/wiki/route';

jest.mock('next-auth');
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    wikiPage: {
      count: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));
jest.mock('@/lib/wiki-generator', () => ({
  runWikiGeneration: jest.fn().mockResolvedValue(undefined),
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { runWikiGeneration } from '@/lib/wiki-generator';

function makeRequest(body: unknown): Request {
  return new Request('http://test/api/wiki', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/wiki', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 without a session', async () => {
    (getServerSession as jest.Mock).mockResolvedValue(null);
    const res = await POST(makeRequest({ topic: 'x' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when topic is missing', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'u@x.com' } });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', email: 'u@x.com' });
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it('returns 429 when user already has 2 generating pages', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'u@x.com' } });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', email: 'u@x.com' });
    (prisma.wikiPage.count as jest.Mock).mockResolvedValue(2);

    const res = await POST(makeRequest({ topic: 'A topic' }));
    expect(res.status).toBe(429);
  });

  it('creates the row and fires the generator', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'u@x.com' } });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', email: 'u@x.com' });
    (prisma.wikiPage.count as jest.Mock).mockResolvedValue(0);
    (prisma.wikiPage.create as jest.Mock).mockResolvedValue({
      id: 'p1', slug: 'authentication', title: 'Authentication', topic: 'Authentication',
      body: '', status: 'generating', createdById: 'u1', lastGeneratedById: 'u1',
    });

    const res = await POST(makeRequest({ topic: 'Authentication', title: 'Authentication' }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.slug).toBe('authentication');

    // fire-and-forget; wait one microtask so the .run() call lands
    await Promise.resolve();
    expect(runWikiGeneration).toHaveBeenCalledWith('p1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api/wiki-create.test.ts`
Expected: FAIL — module `@/app/api/wiki/route` not found.

- [ ] **Step 3: Implement the route**

Create `src/app/api/wiki/route.ts`:

```ts
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { slugify, withSuffix } from '@/lib/wiki-slug';
import { runWikiGeneration } from '@/lib/wiki-generator';

const MAX_CONCURRENT_PER_USER = 2;
const MAX_TOPIC_LEN = 2000;
const MAX_TITLE_LEN = 120;

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new Response('Unauthorized', { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user) return new Response('User not found', { status: 404 });

  const body = (await request.json().catch(() => null)) as
    | { topic?: unknown; title?: unknown }
    | null;
  const topic = typeof body?.topic === 'string' ? body.topic.trim() : '';
  const title = typeof body?.title === 'string' ? body.title.trim() : '';

  if (!topic || topic.length > MAX_TOPIC_LEN) {
    return NextResponse.json({ error: 'Topic required, 1–2000 chars' }, { status: 400 });
  }
  if (title.length > MAX_TITLE_LEN) {
    return NextResponse.json({ error: 'Title must be 1–120 chars' }, { status: 400 });
  }

  const inFlight = await prisma.wikiPage.count({
    where: { lastGeneratedById: user.id, status: 'generating' },
  });
  if (inFlight >= MAX_CONCURRENT_PER_USER) {
    return NextResponse.json(
      { error: 'You already have 2 pages generating. Wait for one to finish.' },
      { status: 429 },
    );
  }

  const effectiveTitle = title || topic.slice(0, MAX_TITLE_LEN);
  const page = await createWithUniqueSlug(effectiveTitle, topic, user.id);

  void runWikiGeneration(page.id).catch((err) => {
    console.error('[wiki] generator threw:', err);
  });

  return NextResponse.json(page, { status: 201 });
}

async function createWithUniqueSlug(title: string, topic: string, userId: string) {
  const base = slugify(title);
  for (let attempt = 0; attempt < 4; attempt++) {
    const slug = attempt === 0 ? base : withSuffix(base);
    try {
      return await prisma.wikiPage.create({
        data: {
          slug,
          title,
          topic,
          body: '',
          status: 'generating',
          createdById: userId,
          lastGeneratedById: userId,
        },
      });
    } catch (err) {
      const msg = (err as { code?: string }).code;
      if (msg === 'P2002' && attempt < 3) continue;
      throw err;
    }
  }
  throw new Error('Could not generate a unique slug after 4 attempts');
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new Response('Unauthorized', { status: 401 });
  }

  const pages = await prisma.wikiPage.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      slug: true,
      title: true,
      topic: true,
      status: true,
      failureReason: true,
      createdAt: true,
      updatedAt: true,
      generatedAt: true,
      regenerationCount: true,
      createdBy: { select: { id: true, name: true, email: true, image: true } },
      lastGeneratedBy: { select: { id: true, name: true, email: true, image: true } },
    },
  });

  return NextResponse.json({ pages });
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/api/wiki-create.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/wiki/route.ts __tests__/api/wiki-create.test.ts
git commit -m "feat(wiki): POST and GET /api/wiki"
```

---

## Task 8: `GET /api/wiki/[slug]` and `DELETE /api/wiki/[slug]`

**Files:**
- Create: `src/app/api/wiki/[slug]/route.ts`
- Test: `__tests__/api/wiki-slug.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/api/wiki-slug.test.ts`:

```ts
import { GET, DELETE } from '@/app/api/wiki/[slug]/route';

jest.mock('next-auth');
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    wikiPage: {
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

function req(slug: string) {
  return {
    request: new Request(`http://test/api/wiki/${slug}`),
    ctx: { params: Promise.resolve({ slug }) },
  };
}

describe('GET /api/wiki/[slug]', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 without session', async () => {
    (getServerSession as jest.Mock).mockResolvedValue(null);
    const { request, ctx } = req('foo');
    const res = await GET(request, ctx);
    expect(res.status).toBe(401);
  });

  it('returns 404 when page does not exist', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'u@x.com' } });
    (prisma.wikiPage.findUnique as jest.Mock).mockResolvedValue(null);
    const { request, ctx } = req('nope');
    const res = await GET(request, ctx);
    expect(res.status).toBe(404);
  });

  it('returns the page with body and user projections', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'u@x.com' } });
    (prisma.wikiPage.findUnique as jest.Mock).mockResolvedValue({
      id: 'p1', slug: 'auth', title: 'Auth', topic: 'Auth', body: '# Hi',
      status: 'ready', createdAt: new Date(), updatedAt: new Date(),
      createdBy: { id: 'u1', name: 'A', email: 'a@x', image: null },
      lastGeneratedBy: { id: 'u1', name: 'A', email: 'a@x', image: null },
    });
    const { request, ctx } = req('auth');
    const res = await GET(request, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.body).toBe('# Hi');
    expect(json.createdBy.name).toBe('A');
  });
});

describe('DELETE /api/wiki/[slug]', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 403 for non-admin users', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'u@x.com' } });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', role: 'user' });
    const { request, ctx } = req('auth');
    const res = await DELETE(request, ctx);
    expect(res.status).toBe(403);
  });

  it('deletes the page for admins and returns 204', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'a1', role: 'admin' });
    (prisma.wikiPage.delete as jest.Mock).mockResolvedValue({ id: 'p1' });
    const { request, ctx } = req('auth');
    const res = await DELETE(request, ctx);
    expect(res.status).toBe(204);
    expect(prisma.wikiPage.delete).toHaveBeenCalledWith({ where: { slug: 'auth' } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api/wiki-slug.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

Create `src/app/api/wiki/[slug]/route.ts`:

```ts
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

type RouteCtx = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, ctx: RouteCtx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { slug } = await ctx.params;
  const page = await prisma.wikiPage.findUnique({
    where: { slug },
    include: {
      createdBy: { select: { id: true, name: true, email: true, image: true } },
      lastGeneratedBy: { select: { id: true, name: true, email: true, image: true } },
    },
  });

  if (!page) return new Response('Not found', { status: 404 });
  return NextResponse.json(page);
}

export async function DELETE(_request: Request, ctx: RouteCtx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new Response('Unauthorized', { status: 401 });
  }

  const currentUser = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!currentUser || currentUser.role !== 'admin') {
    return new Response('Forbidden', { status: 403 });
  }

  const { slug } = await ctx.params;
  try {
    await prisma.wikiPage.delete({ where: { slug } });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2025') {
      return new Response('Not found', { status: 404 });
    }
    throw err;
  }

  return new Response(null, { status: 204 });
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/api/wiki-slug.test.ts`
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/wiki/[slug]/route.ts __tests__/api/wiki-slug.test.ts
git commit -m "feat(wiki): GET and DELETE /api/wiki/[slug]"
```

---

## Task 9: `POST /api/wiki/[slug]/regenerate`

**Files:**
- Create: `src/app/api/wiki/[slug]/regenerate/route.ts`
- Test: `__tests__/api/wiki-regenerate.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/api/wiki-regenerate.test.ts`:

```ts
import { POST } from '@/app/api/wiki/[slug]/regenerate/route';

jest.mock('next-auth');
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    wikiPage: {
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
  },
}));
jest.mock('@/lib/wiki-generator', () => ({
  runWikiGeneration: jest.fn().mockResolvedValue(undefined),
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { runWikiGeneration } from '@/lib/wiki-generator';

function req(slug: string, body: unknown) {
  return {
    request: new Request(`http://test/api/wiki/${slug}/regenerate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    ctx: { params: Promise.resolve({ slug }) },
  };
}

describe('POST /api/wiki/[slug]/regenerate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 without session', async () => {
    (getServerSession as jest.Mock).mockResolvedValue(null);
    const { request, ctx } = req('auth', {});
    const res = await POST(request, ctx);
    expect(res.status).toBe(401);
  });

  it('returns 404 when page does not exist', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'u@x.com' } });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1' });
    (prisma.wikiPage.findUnique as jest.Mock).mockResolvedValue(null);
    const { request, ctx } = req('nope', {});
    const res = await POST(request, ctx);
    expect(res.status).toBe(404);
  });

  it('returns 409 when page is already generating', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'u@x.com' } });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1' });
    (prisma.wikiPage.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', status: 'generating' });
    const { request, ctx } = req('auth', {});
    const res = await POST(request, ctx);
    expect(res.status).toBe(409);
  });

  it('returns 429 when user is at concurrency cap', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'u@x.com' } });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1' });
    (prisma.wikiPage.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', status: 'ready' });
    (prisma.wikiPage.count as jest.Mock).mockResolvedValue(2);
    const { request, ctx } = req('auth', {});
    const res = await POST(request, ctx);
    expect(res.status).toBe(429);
  });

  it('updates page, sets lastGeneratedById to current user, and fires generator', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'u@x.com' } });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1' });
    (prisma.wikiPage.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', status: 'ready' });
    (prisma.wikiPage.count as jest.Mock).mockResolvedValue(0);
    (prisma.wikiPage.update as jest.Mock).mockResolvedValue({ id: 'p1', status: 'generating' });

    const { request, ctx } = req('auth', { extraPrompt: 'also mention SSO' });
    const res = await POST(request, ctx);
    expect(res.status).toBe(200);

    expect(prisma.wikiPage.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: {
        status: 'generating',
        lastGeneratedById: 'u1',
        lastGenerationPrompt: 'also mention SSO',
        failureReason: null,
      },
    });
    await Promise.resolve();
    expect(runWikiGeneration).toHaveBeenCalledWith('p1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api/wiki-regenerate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

Create `src/app/api/wiki/[slug]/regenerate/route.ts`:

```ts
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { runWikiGeneration } from '@/lib/wiki-generator';

const MAX_CONCURRENT_PER_USER = 2;
const MAX_EXTRA_PROMPT_LEN = 1000;

type RouteCtx = { params: Promise<{ slug: string }> };

export async function POST(request: Request, ctx: RouteCtx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new Response('Unauthorized', { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user) return new Response('User not found', { status: 404 });

  const { slug } = await ctx.params;
  const page = await prisma.wikiPage.findUnique({ where: { slug } });
  if (!page) return new Response('Not found', { status: 404 });

  if (page.status === 'generating') {
    return NextResponse.json(
      { error: 'Page is already regenerating. Wait for it to finish.' },
      { status: 409 },
    );
  }

  const body = (await request.json().catch(() => null)) as { extraPrompt?: unknown } | null;
  const rawExtra = typeof body?.extraPrompt === 'string' ? body.extraPrompt.trim() : '';
  if (rawExtra.length > MAX_EXTRA_PROMPT_LEN) {
    return NextResponse.json({ error: 'extraPrompt must be 0–1000 chars' }, { status: 400 });
  }
  const extraPrompt = rawExtra || null;

  const inFlight = await prisma.wikiPage.count({
    where: { lastGeneratedById: user.id, status: 'generating' },
  });
  if (inFlight >= MAX_CONCURRENT_PER_USER) {
    return NextResponse.json(
      { error: 'You already have 2 pages generating. Wait for one to finish.' },
      { status: 429 },
    );
  }

  const updated = await prisma.wikiPage.update({
    where: { id: page.id },
    data: {
      status: 'generating',
      lastGeneratedById: user.id,
      lastGenerationPrompt: extraPrompt,
      failureReason: null,
    },
  });

  void runWikiGeneration(page.id).catch((err) => {
    console.error('[wiki] regenerator threw:', err);
  });

  return NextResponse.json(updated);
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/api/wiki-regenerate.test.ts`
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/wiki/[slug]/regenerate/route.ts __tests__/api/wiki-regenerate.test.ts
git commit -m "feat(wiki): POST /api/wiki/[slug]/regenerate"
```

---

## Task 10: Wiki index page (`/wiki`)

**Files:**
- Create: `src/app/wiki/page.tsx` (server component)
- Create: `src/app/wiki/WikiIndexClient.tsx` (client component)

*No component tests per user preference. Manual QA happens in Task 13.*

- [ ] **Step 1: Create the server entry point**

Create `src/app/wiki/page.tsx`:

```tsx
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import WikiIndexClient from './WikiIndexClient';

export default async function WikiIndexPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/login');
  return <WikiIndexClient />;
}
```

- [ ] **Step 2: Create the client list**

Create `src/app/wiki/WikiIndexClient.tsx`:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type User = { id: string; name: string; email: string; image: string | null };
type WikiPageSummary = {
  id: string;
  slug: string;
  title: string;
  topic: string;
  status: 'generating' | 'ready' | 'failed';
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  generatedAt: string | null;
  regenerationCount: number;
  createdBy: User;
  lastGeneratedBy: User;
};

const POLL_MS = 5000;

export default function WikiIndexClient() {
  const [pages, setPages] = useState<WikiPageSummary[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchPages = async () => {
    const res = await fetch('/api/wiki');
    if (res.ok) {
      const json = (await res.json()) as { pages: WikiPageSummary[] };
      setPages(json.pages);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchPages();
  }, []);

  useEffect(() => {
    const anyGenerating = pages.some((p) => p.status === 'generating');
    if (!anyGenerating) return;
    const t = setInterval(fetchPages, POLL_MS);
    return () => clearInterval(t);
  }, [pages]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return pages;
    return pages.filter(
      (p) => p.title.toLowerCase().includes(needle) || p.topic.toLowerCase().includes(needle),
    );
  }, [pages, q]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Wiki</h1>
        <Link
          href="/wiki/new"
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          Create wiki page
        </Link>
      </header>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search pages…"
        className="mb-4 w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800"
      />

      {loading && <p className="text-gray-500">Loading…</p>}

      {!loading && filtered.length === 0 && (
        <p className="text-gray-500">No wiki pages yet. Click "Create wiki page" to start.</p>
      )}

      <ul className="space-y-3">
        {filtered.map((p) => (
          <li key={p.id}>
            <Link
              href={`/wiki/${p.slug}`}
              className="block rounded border border-gray-200 p-4 hover:border-blue-400 dark:border-gray-800"
            >
              <div className="flex items-start justify-between">
                <h2 className="text-lg font-medium">{p.title}</h2>
                <StatusBadge status={p.status} />
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-gray-600 dark:text-gray-400">
                {p.topic}
              </p>
              <p className="mt-2 text-xs text-gray-500">
                Created by {p.createdBy.name} · {p.regenerationCount} regeneration
                {p.regenerationCount === 1 ? '' : 's'}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

function StatusBadge({ status }: { status: 'generating' | 'ready' | 'failed' }) {
  const label = status === 'generating' ? 'Generating…' : status === 'ready' ? 'Ready' : 'Failed';
  const cls =
    status === 'ready'
      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
      : status === 'failed'
        ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
        : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
  return <span className={`rounded px-2 py-0.5 text-xs ${cls}`}>{label}</span>;
}
```

- [ ] **Step 3: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: passes.

```bash
git add src/app/wiki/page.tsx src/app/wiki/WikiIndexClient.tsx
git commit -m "feat(wiki): add /wiki index page"
```

---

## Task 11: Wiki create page (`/wiki/new`)

**Files:**
- Create: `src/app/wiki/new/page.tsx`
- Create: `src/app/wiki/new/WikiNewClient.tsx`

- [ ] **Step 1: Create the server entry point**

Create `src/app/wiki/new/page.tsx`:

```tsx
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import WikiNewClient from './WikiNewClient';

export default async function WikiNewPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/login');
  return <WikiNewClient />;
}
```

- [ ] **Step 2: Create the client form**

Create `src/app/wiki/new/WikiNewClient.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const MAX_TOPIC_LEN = 2000;
const MAX_TITLE_LEN = 120;

export default function WikiNewClient() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!topic.trim()) {
      setError('Topic is required');
      return;
    }
    setSubmitting(true);
    const res = await fetch('/api/wiki', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: title.trim() || undefined, topic: topic.trim() }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({ error: 'Failed to create page' }));
      setError(json.error || 'Failed to create page');
      return;
    }
    const page = (await res.json()) as { slug: string };
    router.push(`/wiki/${page.slug}`);
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">Create wiki page</h1>

      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium">Title (optional)</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MAX_TITLE_LEN}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800"
            placeholder="e.g. How badge printing works"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Topic *</span>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            maxLength={MAX_TOPIC_LEN}
            rows={6}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800"
            placeholder="Describe what the page should cover."
            required
          />
          <span className="mt-1 block text-xs text-gray-500">
            {topic.length}/{MAX_TOPIC_LEN}
          </span>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create and generate'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/wiki')}
            className="rounded border border-gray-300 px-4 py-2 dark:border-gray-700"
          >
            Cancel
          </button>
        </div>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: passes.

```bash
git add src/app/wiki/new/page.tsx src/app/wiki/new/WikiNewClient.tsx
git commit -m "feat(wiki): add /wiki/new create form"
```

---

## Task 12: Wiki detail page (`/wiki/[slug]`)

**Files:**
- Create: `src/app/wiki/[slug]/page.tsx`
- Create: `src/app/wiki/[slug]/WikiDetailClient.tsx`

- [ ] **Step 1: Create the server entry point**

Create `src/app/wiki/[slug]/page.tsx`:

```tsx
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import WikiDetailClient from './WikiDetailClient';

type PageProps = { params: Promise<{ slug: string }> };

export default async function WikiDetailPage({ params }: PageProps) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/login');

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { role: true },
  });

  const { slug } = await params;
  return <WikiDetailClient slug={slug} isAdmin={currentUser?.role === 'admin'} />;
}
```

- [ ] **Step 2: Create the client view**

Create `src/app/wiki/[slug]/WikiDetailClient.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const POLL_MS = 5000;
const MAX_EXTRA_PROMPT_LEN = 1000;

type User = { id: string; name: string; email: string; image: string | null };
type WikiPage = {
  id: string;
  slug: string;
  title: string;
  topic: string;
  body: string;
  status: 'generating' | 'ready' | 'failed';
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  generatedAt: string | null;
  regenerationCount: number;
  lastGenerationPrompt: string | null;
  createdBy: User;
  lastGeneratedBy: User;
};

export default function WikiDetailClient({ slug, isAdmin }: { slug: string; isAdmin: boolean }) {
  const router = useRouter();
  const [page, setPage] = useState<WikiPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [showRegenModal, setShowRegenModal] = useState(false);
  const [extraPrompt, setExtraPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fetchPage = async () => {
    const res = await fetch(`/api/wiki/${slug}`);
    if (res.status === 404) {
      router.push('/wiki');
      return;
    }
    if (res.ok) {
      setPage((await res.json()) as WikiPage);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    if (page?.status !== 'generating') return;
    const t = setInterval(fetchPage, POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.status]);

  async function doRegenerate(extra: string) {
    setRegenerating(true);
    setError(null);
    const res = await fetch(`/api/wiki/${slug}/regenerate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ extraPrompt: extra || undefined }),
    });
    setRegenerating(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({ error: 'Failed to regenerate' }));
      setError(json.error || 'Failed to regenerate');
      return;
    }
    setShowRegenModal(false);
    setExtraPrompt('');
    fetchPage();
  }

  async function doDelete() {
    if (!confirm('Delete this wiki page? This cannot be undone.')) return;
    const res = await fetch(`/api/wiki/${slug}`, { method: 'DELETE' });
    if (res.ok) router.push('/wiki');
  }

  if (loading) return <main className="p-8 text-gray-500">Loading…</main>;
  if (!page) return <main className="p-8 text-gray-500">Not found.</main>;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-4">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-3xl font-semibold">{page.title}</h1>
          <div className="flex gap-2">
            <button
              onClick={() => setShowRegenModal(true)}
              disabled={page.status === 'generating'}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              Regenerate
            </button>
            {isAdmin && (
              <button
                onClick={doDelete}
                disabled={page.status === 'generating'}
                className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
              >
                Delete
              </button>
            )}
          </div>
        </div>
        <p className="mt-2 text-sm text-gray-500">
          Created by {page.createdBy.name} · Last generated by {page.lastGeneratedBy.name} ·{' '}
          {page.regenerationCount} regeneration{page.regenerationCount === 1 ? '' : 's'}
          {page.generatedAt && ` · ${new Date(page.generatedAt).toLocaleString()}`}
        </p>
      </header>

      {page.status === 'generating' && (
        <div className="rounded border border-yellow-300 bg-yellow-50 p-4 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
          Generating this page… it will appear here when ready.
        </div>
      )}

      {page.status === 'failed' && (
        <div className="rounded border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
          <p className="text-red-800 dark:text-red-200">
            Generation failed: {page.failureReason ?? 'Unknown error'}
          </p>
          <button
            onClick={() => doRegenerate('')}
            disabled={regenerating}
            className="mt-2 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}

      {page.status === 'ready' && (
        <article className="prose dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{page.body}</ReactMarkdown>
        </article>
      )}

      {showRegenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded bg-white p-6 dark:bg-gray-900">
            <h2 className="mb-2 text-lg font-semibold">Regenerate wiki page</h2>
            <p className="mb-3 text-sm text-gray-500">
              Topic: <span className="italic">{page.topic}</span>
            </p>
            <label className="block">
              <span className="text-sm font-medium">
                Anything to focus on this time? (optional)
              </span>
              <textarea
                value={extraPrompt}
                onChange={(e) => setExtraPrompt(e.target.value)}
                maxLength={MAX_EXTRA_PROMPT_LEN}
                rows={4}
                className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800"
              />
            </label>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowRegenModal(false);
                  setExtraPrompt('');
                  setError(null);
                }}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={() => doRegenerate(extraPrompt.trim())}
                disabled={regenerating}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {regenerating ? 'Starting…' : 'Regenerate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: passes.

```bash
git add src/app/wiki/[slug]/page.tsx src/app/wiki/[slug]/WikiDetailClient.tsx
git commit -m "feat(wiki): add /wiki/[slug] detail page with regenerate and delete"
```

---

## Task 13: Add Wiki link to the sidebar

**Files:**
- Modify: `src/components/ChatSidebar.tsx`

- [ ] **Step 1: Find the nav section**

Open `src/components/ChatSidebar.tsx`. Locate the existing navigation links (there will be entries for Chat, Dashboard, Knowledge, and possibly Admin). Each is likely a `<Link>` with an `href` pointing at `/`, `/dashboard`, `/knowledge` etc.

- [ ] **Step 2: Add a Wiki link next to Knowledge**

Add a new link alongside the existing Knowledge link, matching its styling exactly. Example (adapt to the surrounding component structure):

```tsx
<Link href="/wiki" className={linkClass('/wiki')}>
  Wiki
</Link>
```

Whatever helper renders the link label + icon + active state for the other nav entries, use the same pattern here.

- [ ] **Step 3: Manual smoke check**

Run: `npm run dev` and open `http://localhost:3000` while signed in. The sidebar should show a "Wiki" entry that navigates to `/wiki`. Kill the dev server after verifying.

- [ ] **Step 4: Commit**

```bash
git add src/components/ChatSidebar.tsx
git commit -m "feat(wiki): add Wiki link to sidebar"
```

---

## Task 14: Manual QA and end-to-end verification

**Files:** none

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests PASS, including the new wiki tests (slug, config, generator, 3 API test files).

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 3: Run a production build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Manual QA checklist**

Start the dev server: `npm run dev`. Signed in as a user with a linked Claude account, verify each of the following works in the browser:

- Sidebar shows **Wiki** link; clicking it lands on `/wiki`.
- `/wiki` shows an empty state when there are no pages.
- Click **Create wiki page** → fill topic "How badge printing works" → submit. Redirects to `/wiki/[slug]` with a "Generating…" placeholder.
- Return to `/wiki`; the card shows the "Generating…" badge.
- Wait for generation to finish (watch the index polling). Card flips to "Ready". Open the page.
- Detail page renders markdown, shows attribution row ("Created by… · Last generated by… · 1 regeneration · {timestamp}").
- Click **Regenerate**. Modal pops up with topic pre-filled and an optional focus field. Enter "focus on troubleshooting tips" and submit. Body flips back to "Generating…", then updates with new content. Regeneration count increments to 2.
- Verify the generated markdown contains no file paths, code blocks, function names, or other developer references.
- As a second, non-admin user: navigate to the same page — it's visible. Regenerate works (the second user's token is used). `lastGeneratedBy` now reflects user 2 on the index card and detail page. `createdBy` still reflects user 1.
- As an admin: **Delete** button appears on the detail page. Click it → confirm → redirected to `/wiki`, page is gone.
- As a non-admin: **Delete** button is not shown.
- Trigger a failure (temporarily unset the user's Claude token in the DB): create a new page, observe "Generation failed: Claude authentication required" + **Retry** button.
- Try creating 3 pages rapidly from one user — third request returns a 429 / friendly error.

- [ ] **Step 5: Commit any follow-up fixes**

If the manual QA surfaces bugs, fix them in separate focused commits. Otherwise skip this step.

- [ ] **Step 6: Open a PR and request review**

```bash
git push -u origin feature/wiki-pages
gh pr create --title "feat(wiki): user-triggered, Claude-authored wiki pages" --body "$(cat <<'EOF'
## Summary
- New WikiPage Prisma model with immutable createdById and mutable lastGeneratedById
- New /api/wiki routes (create, list, read, regenerate, admin delete)
- New /wiki index, /wiki/new, /wiki/[slug] pages
- Generation runs fire-and-forget on the server using the lastGeneratedBy user's Claude token
- Startup sweep marks stranded generating pages as failed after 15 min idle

## Spec
See docs/superpowers/specs/2026-04-15-wiki-pages-design.md

## Test plan
- [x] npm test
- [x] npm run lint
- [x] npm run build
- [x] Manual QA checklist from docs/superpowers/plans/2026-04-15-wiki-pages.md (Task 14, Step 4)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Per the "reviews at the end" preference, this is where one reviewer pass covers the whole branch.
