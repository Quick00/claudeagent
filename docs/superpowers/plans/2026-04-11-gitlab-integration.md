# GitLab Multi-Repo Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support multiple GitLab.com repositories with automatic question routing via OpenRouter, admin-managed repo configuration, and read-only repo clones.

**Architecture:** New `Repository` model links to `Conversation` and `KnowledgeEntry`. Admin adds repos via UI (GitLab API search). Repos are cloned read-only to `REPOS_DIR`. A lightweight OpenRouter call routes each question to the best repo before spawning Claude CLI with that repo's `--add-dir` path. A cron script periodically syncs repos.

**Tech Stack:** Next.js 16 App Router, Prisma 7 (PostgreSQL), OpenRouter API, GitLab REST API v4, Node.js child_process

**Spec:** `docs/superpowers/specs/2026-04-11-gitlab-integration-design.md`

---

## File Map

### New Files
| File | Responsibility |
|---|---|
| `src/lib/repo-manager.ts` | Clone repos, enforce read-only permissions, sync/pull |
| `src/lib/repo-router.ts` | Route questions to repos via OpenRouter |
| `src/app/api/admin/repos/route.ts` | List repos (GET), add repo (POST) |
| `src/app/api/admin/repos/[id]/route.ts` | Update repo (PATCH), delete repo (DELETE) |
| `src/app/api/admin/gitlab/search/route.ts` | Proxy search to GitLab API |
| `src/app/admin/repos/page.tsx` | Admin repo management UI |
| `scripts/sync-repos.ts` | Cron script: pull all active repos |
| `src/lib/__tests__/repo-manager.test.ts` | Tests for clone/sync/permissions |
| `src/lib/__tests__/repo-router.test.ts` | Tests for routing logic |
| `src/app/api/admin/repos/__tests__/route.test.ts` | Tests for repo API |

### Modified Files
| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `Repository` model, add `repositoryId` FK to `Conversation` and `KnowledgeEntry` |
| `src/lib/config.ts` | Add `reposDir`, `gitlabToken` config fields |
| `src/lib/session-manager.ts` | Accept `repoPath` param in `startSession`/`resumeSession` instead of reading `config.repoPath` |
| `src/app/api/chat/route.ts` | Add routing step before Claude spawn, pass `repositoryId` to conversation |
| `src/app/api/knowledge/route.ts` | Accept optional `repositoryId` in POST, include `repository` relation in GET |
| `src/lib/embeddings.ts` | Include `repository` name in `findRelevantEntries` results |
| `src/mcp/knowledge-server.mjs` | Pass `repositoryId` in save_knowledge calls |
| `.env.example` | Add `GITLAB_TOKEN`, `REPOS_DIR`; remove `GITLAB_WEBHOOK_SECRET` |

### Modified Files (Docker/Infra)
| File | Change |
|---|---|
| `docker-entrypoint.sh` | Remove SSH keyscan block, update single-repo chown to multi-repo REPOS_DIR |
| `docker-compose.yml` | Remove `~/.ssh` volume mount, replace `repo` volume with `repos`, add REPOS_DIR env |

### Deleted Files
| File | Reason |
|---|---|
| `src/app/api/webhook/gitlab/route.ts` | Replaced by sync script |
| `src/lib/git-pull.ts` | Replaced by repo-manager.ts |

---

## Task 1: Database Schema

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add Repository model and update relations**

Add the `Repository` model after `Flag` in `prisma/schema.prisma`, and add optional `repositoryId` FK to `Conversation` and `KnowledgeEntry`:

```prisma
model Repository {
  id               String    @id @default(uuid())
  name             String
  description      String
  gitlabProjectId  Int       @unique
  gitlabUrl        String
  defaultBranch    String    @default("main")
  localPath        String
  lastPulledAt     DateTime?
  active           Boolean   @default(true)
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  conversations    Conversation[]
  knowledgeEntries KnowledgeEntry[]
}
```

Add to the `Conversation` model (after `claudeSessionId`):

```prisma
  repositoryId   String?
  repository     Repository? @relation(fields: [repositoryId], references: [id])
```

Add to the `KnowledgeEntry` model (after `source`):

```prisma
  repositoryId   String?
  repository     Repository? @relation(fields: [repositoryId], references: [id])
```

- [ ] **Step 2: Generate and run migration**

```bash
npx prisma migrate dev --name add-repository-model
```

Expected: Migration creates `Repository` table, adds nullable `repositoryId` columns to `Conversation` and `KnowledgeEntry`.

- [ ] **Step 3: Regenerate Prisma client**

```bash
npx prisma generate
```

Expected: No errors.

- [ ] **Step 4: Verify build**

```bash
npm run build 2>&1 | head -20
```

Expected: Build succeeds (new columns are optional, no breaking changes).

- [ ] **Step 5: Commit**

```bash
git add prisma/
git commit -m "feat: add Repository model with Conversation and KnowledgeEntry relations"
```

---

## Task 2: Repo Manager (Clone + Read-Only Enforcement)

**Files:**
- Create: `src/lib/repo-manager.ts`
- Create: `src/lib/__tests__/repo-manager.test.ts`

- [ ] **Step 1: Write failing tests for repo manager**

Create `src/lib/__tests__/repo-manager.test.ts`:

```typescript
import { cloneRepo, makeReadOnly, makeWritable, syncRepo } from '@/lib/repo-manager';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Test with a real temp directory but mock git commands
jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

describe('repo-manager', () => {
  const tmpDir = path.join(os.tmpdir(), 'repo-manager-test');

  beforeEach(() => {
    jest.clearAllMocks();
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('cloneRepo', () => {
    it('clones via HTTPS with token and sets read-only', async () => {
      mockExecSync.mockReturnValue(Buffer.from(''));

      await cloneRepo({
        gitlabUrl: 'https://gitlab.com/mygroup/myrepo.git',
        localPath: path.join(tmpDir, 'myrepo'),
        branch: 'main',
        token: 'glpat-abc123',
      });

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('git clone --branch main --single-branch'),
        expect.objectContaining({ timeout: 300000 }),
      );
      // URL should include token for HTTPS auth
      const cloneCall = mockExecSync.mock.calls[0][0] as string;
      expect(cloneCall).toContain('oauth2:glpat-abc123@gitlab.com');
      // Should set read-only after clone
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('chmod -R a-w'),
        expect.anything(),
      );
    });
  });

  describe('syncRepo', () => {
    it('makes writable, pulls, then makes read-only again', async () => {
      const repoPath = path.join(tmpDir, 'myrepo');
      fs.mkdirSync(repoPath, { recursive: true });
      mockExecSync.mockReturnValue(Buffer.from('Already up to date.'));

      await syncRepo({
        localPath: repoPath,
        branch: 'main',
        token: 'glpat-abc123',
        gitlabUrl: 'https://gitlab.com/mygroup/myrepo.git',
      });

      const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
      // First: make writable
      expect(calls[0]).toContain('chmod -R u+w');
      // Then: fetch
      expect(calls[1]).toContain('git fetch');
      // Then: reset to origin branch
      expect(calls[2]).toContain('git reset --hard origin/main');
      // Finally: make read-only
      expect(calls[3]).toContain('chmod -R a-w');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest src/lib/__tests__/repo-manager.test.ts --no-coverage 2>&1
```

Expected: FAIL — `Cannot find module '@/lib/repo-manager'`

- [ ] **Step 3: Implement repo-manager.ts**

Create `src/lib/repo-manager.ts`:

```typescript
import { execSync } from 'child_process';
import fs from 'fs';

interface CloneOptions {
  gitlabUrl: string;
  localPath: string;
  branch: string;
  token: string;
}

interface SyncOptions {
  localPath: string;
  branch: string;
  token: string;
  gitlabUrl: string;
}

/**
 * Clone a GitLab repo via HTTPS and immediately set it read-only.
 * The token is injected into the URL for authentication.
 * SECURITY: Repos are NEVER writable after clone completes.
 */
export async function cloneRepo({ gitlabUrl, localPath, branch, token }: CloneOptions): Promise<void> {
  // Inject token into HTTPS URL: https://gitlab.com/... -> https://oauth2:TOKEN@gitlab.com/...
  const authedUrl = gitlabUrl.replace('https://gitlab.com/', `https://oauth2:${token}@gitlab.com/`);

  execSync(
    `git clone --branch ${branch} --single-branch ${authedUrl} ${localPath}`,
    { timeout: 300000, stdio: 'pipe' },
  );

  makeReadOnly(localPath);
}

/**
 * Sync a cloned repo: make temporarily writable, fetch + reset, then lock down again.
 * SECURITY: Even if the process crashes mid-sync, the repo was read-only before
 * and will be re-locked on the next sync cycle.
 */
export async function syncRepo({ localPath, branch, token, gitlabUrl }: SyncOptions): Promise<void> {
  if (!fs.existsSync(localPath)) {
    throw new Error(`Repo path does not exist: ${localPath}`);
  }

  // Temporarily make writable for git operations
  makeWritable(localPath);

  try {
    // Set the remote URL with token (in case token changed)
    const authedUrl = gitlabUrl.replace('https://gitlab.com/', `https://oauth2:${token}@gitlab.com/`);
    execSync(`git remote set-url origin ${authedUrl}`, { cwd: localPath, stdio: 'pipe' });

    execSync(`git fetch origin ${branch}`, { cwd: localPath, timeout: 120000, stdio: 'pipe' });
    execSync(`git reset --hard origin/${branch}`, { cwd: localPath, stdio: 'pipe' });
  } finally {
    // ALWAYS re-lock, even if fetch/reset failed
    makeReadOnly(localPath);
  }
}

/** Remove all write permissions from repo directory. */
export function makeReadOnly(dirPath: string): void {
  execSync(`chmod -R a-w ${dirPath}`, { stdio: 'pipe' });
}

/** Temporarily restore write permissions for git operations. */
export function makeWritable(dirPath: string): void {
  execSync(`chmod -R u+w ${dirPath}`, { stdio: 'pipe' });
}

/** Remove a cloned repo from disk. */
export async function removeRepo(localPath: string): Promise<void> {
  if (!fs.existsSync(localPath)) return;
  // Need write permissions to delete
  makeWritable(localPath);
  fs.rmSync(localPath, { recursive: true, force: true });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest src/lib/__tests__/repo-manager.test.ts --no-coverage 2>&1
```

Expected: PASS — all 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/repo-manager.ts src/lib/__tests__/repo-manager.test.ts
git commit -m "feat: add repo-manager with clone, sync, and read-only enforcement"
```

---

## Task 3: Config Updates

**Files:**
- Modify: `src/lib/config.ts`

- [ ] **Step 1: Add new config fields**

Add `reposDir` and `gitlabToken` to the config object in `src/lib/config.ts`:

```typescript
reposDir: process.env.REPOS_DIR || './repos',
gitlabToken: process.env.GITLAB_TOKEN || '',
```

These go alongside the existing `repoPath` field. `repoPath` stays as a fallback.

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | head -10
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/lib/config.ts
git commit -m "feat: add reposDir and gitlabToken to config"
```

---

## Task 4: Admin API — Repository CRUD

**Files:**
- Create: `src/app/api/admin/repos/route.ts`
- Create: `src/app/api/admin/repos/[id]/route.ts`

- [ ] **Step 1: Create list and add routes**

Create `src/app/api/admin/repos/route.ts`:

```typescript
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { cloneRepo } from '@/lib/repo-manager';
import path from 'path';
import fs from 'fs';

// GET: List all repositories
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new Response('Unauthorized', { status: 401 });
  }
  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  if (!currentUser || currentUser.role !== 'admin') {
    return new Response('Forbidden', { status: 403 });
  }

  const repos = await prisma.repository.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      description: true,
      gitlabProjectId: true,
      gitlabUrl: true,
      defaultBranch: true,
      localPath: true,
      lastPulledAt: true,
      active: true,
      createdAt: true,
    },
  });

  return NextResponse.json(repos);
}

// POST: Add a new repository (clones it)
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new Response('Unauthorized', { status: 401 });
  }
  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  if (!currentUser || currentUser.role !== 'admin') {
    return new Response('Forbidden', { status: 403 });
  }

  const body = await request.json();
  const { name, description, gitlabProjectId, gitlabUrl, defaultBranch } = body as {
    name: string;
    description: string;
    gitlabProjectId: number;
    gitlabUrl: string;
    defaultBranch: string;
  };

  if (!name || !description || !gitlabProjectId || !gitlabUrl) {
    return new Response('name, description, gitlabProjectId, and gitlabUrl are required', { status: 400 });
  }

  // Check for duplicate GitLab project
  const existing = await prisma.repository.findUnique({
    where: { gitlabProjectId },
  });
  if (existing) {
    return Response.json({ error: 'This GitLab project has already been added' }, { status: 409 });
  }

  const localPath = path.join(config.reposDir, String(gitlabProjectId));

  // Create DB record first (status: cloning)
  const repo = await prisma.repository.create({
    data: {
      name,
      description,
      gitlabProjectId,
      gitlabUrl,
      defaultBranch: defaultBranch || 'main',
      localPath,
      active: false, // inactive until clone completes
    },
  });

  // Clone async — don't block the response
  cloneRepo({
    gitlabUrl,
    localPath,
    branch: defaultBranch || 'main',
    token: config.gitlabToken,
  })
    .then(async () => {
      await prisma.repository.update({
        where: { id: repo.id },
        data: { active: true, lastPulledAt: new Date() },
      });
      console.log(`[repos] Cloned and activated: ${name} (${gitlabProjectId})`);
    })
    .catch(async (err) => {
      console.error(`[repos] Failed to clone ${name}:`, (err as Error).message);
      // Clean up partial clone
      if (fs.existsSync(localPath)) {
        fs.rmSync(localPath, { recursive: true, force: true });
      }
    });

  return NextResponse.json({ ...repo, status: 'cloning' }, { status: 201 });
}
```

- [ ] **Step 2: Create single-repo update and delete routes**

Create `src/app/api/admin/repos/[id]/route.ts`:

```typescript
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { removeRepo } from '@/lib/repo-manager';

// PATCH: Update repo description or toggle active
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new Response('Unauthorized', { status: 401 });
  }
  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  if (!currentUser || currentUser.role !== 'admin') {
    return new Response('Forbidden', { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const { description, active } = body as {
    description?: string;
    active?: boolean;
  };

  const data: Record<string, unknown> = {};
  if (description !== undefined) data.description = description;
  if (active !== undefined) data.active = active;

  if (Object.keys(data).length === 0) {
    return new Response('No fields to update', { status: 400 });
  }

  const repo = await prisma.repository.update({
    where: { id },
    data,
  });

  return NextResponse.json(repo);
}

// DELETE: Remove repo and its clone
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new Response('Unauthorized', { status: 401 });
  }
  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  if (!currentUser || currentUser.role !== 'admin') {
    return new Response('Forbidden', { status: 403 });
  }

  const { id } = await params;

  const repo = await prisma.repository.findUnique({ where: { id } });
  if (!repo) {
    return new Response('Not found', { status: 404 });
  }

  // Nullify references in conversations and knowledge entries
  await prisma.conversation.updateMany({
    where: { repositoryId: id },
    data: { repositoryId: null },
  });
  await prisma.knowledgeEntry.updateMany({
    where: { repositoryId: id },
    data: { repositoryId: null },
  });

  // Delete DB record
  await prisma.repository.delete({ where: { id } });

  // Remove clone from disk
  await removeRepo(repo.localPath);

  return new Response(null, { status: 204 });
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/repos/
git commit -m "feat: add admin API routes for repository CRUD"
```

---

## Task 5: GitLab Search Proxy API

**Files:**
- Create: `src/app/api/admin/gitlab/search/route.ts`

- [ ] **Step 1: Create GitLab search proxy route**

Create `src/app/api/admin/gitlab/search/route.ts`:

```typescript
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { config } from '@/lib/config';

// GET: Search GitLab projects
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new Response('Unauthorized', { status: 401 });
  }
  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  if (!currentUser || currentUser.role !== 'admin') {
    return new Response('Forbidden', { status: 403 });
  }

  if (!config.gitlabToken) {
    return Response.json({ error: 'GITLAB_TOKEN is not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  if (!query) {
    return new Response('q parameter is required', { status: 400 });
  }

  const response = await fetch(
    `https://gitlab.com/api/v4/projects?search=${encodeURIComponent(query)}&membership=true&per_page=20&order_by=last_activity_at`,
    {
      headers: {
        'PRIVATE-TOKEN': config.gitlabToken,
      },
    },
  );

  if (!response.ok) {
    const text = await response.text();
    console.error('[gitlab] Search failed:', response.status, text);
    return Response.json({ error: 'GitLab API request failed' }, { status: response.status });
  }

  const projects = await response.json();

  // Map to only the fields we need
  const results = projects.map((p: Record<string, unknown>) => ({
    id: p.id,
    name: p.name,
    nameWithNamespace: p.name_with_namespace,
    description: p.description,
    webUrl: p.web_url,
    httpUrlToRepo: p.http_url_to_repo,
    defaultBranch: p.default_branch,
    lastActivityAt: p.last_activity_at,
  }));

  return NextResponse.json(results);
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/gitlab/
git commit -m "feat: add GitLab project search proxy API"
```

---

## Task 6: Admin UI — Repo Management Page

**Files:**
- Create: `src/app/admin/repos/page.tsx`

- [ ] **Step 1: Create the admin repos page**

Create `src/app/admin/repos/page.tsx` (follows pattern from `src/app/admin/users/page.tsx`):

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import Link from 'next/link';

interface Repository {
  id: string;
  name: string;
  description: string;
  gitlabProjectId: number;
  gitlabUrl: string;
  defaultBranch: string;
  lastPulledAt: string | null;
  active: boolean;
  createdAt: string;
}

interface GitLabProject {
  id: number;
  name: string;
  nameWithNamespace: string;
  description: string | null;
  webUrl: string;
  httpUrlToRepo: string;
  defaultBranch: string;
  lastActivityAt: string;
}

export default function AdminReposPage() {
  const { data: session, status } = useSession();
  const [repos, setRepos] = useState<Repository[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GitLabProject[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<number | null>(null);
  const [descriptions, setDescriptions] = useState<Record<number, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') redirect('/login');
    if (status === 'authenticated') fetchRepos();
  }, [status]);

  const fetchRepos = async () => {
    const res = await fetch('/api/admin/repos');
    if (res.status === 403) redirect('/');
    if (res.ok) setRepos(await res.json());
  };

  const searchGitLab = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/admin/gitlab/search?q=${encodeURIComponent(searchQuery)}`);
      if (res.ok) {
        const results = await res.json();
        // Filter out already-added projects
        const addedIds = new Set(repos.map((r) => r.gitlabProjectId));
        setSearchResults(results.filter((p: GitLabProject) => !addedIds.has(p.id)));
      }
    } finally {
      setSearching(false);
    }
  };

  const addRepo = async (project: GitLabProject) => {
    const description = descriptions[project.id];
    if (!description?.trim()) {
      alert('Please write a description for this repo — it helps route questions to the right codebase.');
      return;
    }
    setAddingId(project.id);
    try {
      const res = await fetch('/api/admin/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: project.name,
          description,
          gitlabProjectId: project.id,
          gitlabUrl: project.httpUrlToRepo,
          defaultBranch: project.defaultBranch || 'main',
        }),
      });
      if (res.ok) {
        setSearchResults((prev) => prev.filter((p) => p.id !== project.id));
        setDescriptions((prev) => {
          const next = { ...prev };
          delete next[project.id];
          return next;
        });
        await fetchRepos();
      }
    } finally {
      setAddingId(null);
    }
  };

  const toggleActive = async (repo: Repository) => {
    const res = await fetch(`/api/admin/repos/${repo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !repo.active }),
    });
    if (res.ok) await fetchRepos();
  };

  const saveDescription = async (repoId: string) => {
    const res = await fetch(`/api/admin/repos/${repoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: editDescription }),
    });
    if (res.ok) {
      setEditingId(null);
      await fetchRepos();
    }
  };

  const deleteRepo = async (repo: Repository) => {
    if (!confirm(`Delete "${repo.name}"? This will remove the local clone. Conversations and knowledge entries linked to this repo will be unlinked.`)) return;
    const res = await fetch(`/api/admin/repos/${repo.id}`, { method: 'DELETE' });
    if (res.ok) await fetchRepos();
  };

  if (status === 'loading') return null;

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/admin/users" className="text-blue-500 hover:text-blue-400 text-sm">&larr; Users</Link>
        <h1 className="text-2xl font-bold dark:text-white">Repositories</h1>
      </div>

      {/* GitLab Search */}
      <div className="mb-8 bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
        <h2 className="text-lg font-semibold dark:text-white mb-3">Add from GitLab</h2>
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && searchGitLab()}
            placeholder="Search GitLab projects..."
            className="flex-1 px-3 py-2 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          />
          <button
            onClick={searchGitLab}
            disabled={searching}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {searching ? 'Searching...' : 'Search'}
          </button>
        </div>

        {searchResults.length > 0 && (
          <div className="space-y-3">
            {searchResults.map((project) => (
              <div key={project.id} className="border dark:border-gray-600 rounded p-3">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <span className="font-medium dark:text-white">{project.nameWithNamespace}</span>
                    {project.description && (
                      <p className="text-sm text-gray-500 dark:text-gray-400">{project.description}</p>
                    )}
                  </div>
                </div>
                <textarea
                  value={descriptions[project.id] || ''}
                  onChange={(e) => setDescriptions((prev) => ({ ...prev, [project.id]: e.target.value }))}
                  placeholder="Describe this repo for question routing (e.g. 'Main web application handling user accounts, dashboards, and billing')"
                  className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white text-sm mb-2"
                  rows={2}
                />
                <button
                  onClick={() => addRepo(project)}
                  disabled={addingId === project.id}
                  className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
                >
                  {addingId === project.id ? 'Cloning...' : 'Add Repository'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Repos Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b dark:border-gray-700">
              <th className="p-3 dark:text-gray-300">Name</th>
              <th className="p-3 dark:text-gray-300">Description</th>
              <th className="p-3 dark:text-gray-300">Status</th>
              <th className="p-3 dark:text-gray-300">Last Synced</th>
              <th className="p-3 dark:text-gray-300">Actions</th>
            </tr>
          </thead>
          <tbody>
            {repos.map((repo) => (
              <tr key={repo.id} className="border-b dark:border-gray-700">
                <td className="p-3 dark:text-white font-medium">{repo.name}</td>
                <td className="p-3 dark:text-gray-300 max-w-md">
                  {editingId === repo.id ? (
                    <div className="flex gap-2">
                      <textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        className="flex-1 px-2 py-1 rounded border dark:border-gray-600 dark:bg-gray-700 dark:text-white text-sm"
                        rows={2}
                      />
                      <button onClick={() => saveDescription(repo.id)} className="text-green-500 text-sm">Save</button>
                      <button onClick={() => setEditingId(null)} className="text-gray-500 text-sm">Cancel</button>
                    </div>
                  ) : (
                    <span
                      onClick={() => { setEditingId(repo.id); setEditDescription(repo.description); }}
                      className="cursor-pointer hover:text-blue-400 text-sm"
                    >
                      {repo.description}
                    </span>
                  )}
                </td>
                <td className="p-3">
                  <button
                    onClick={() => toggleActive(repo)}
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      repo.active
                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                    }`}
                  >
                    {repo.active ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td className="p-3 text-sm dark:text-gray-400">
                  {repo.lastPulledAt
                    ? new Date(repo.lastPulledAt).toLocaleString()
                    : 'Cloning...'}
                </td>
                <td className="p-3">
                  <button
                    onClick={() => deleteRepo(repo)}
                    className="text-red-500 hover:text-red-400 text-sm"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {repos.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-gray-500 dark:text-gray-400">
                  No repositories added yet. Search GitLab above to add one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/repos/
git commit -m "feat: add admin repos management page with GitLab search"
```

---

## Task 7: Repo Router (OpenRouter)

**Files:**
- Create: `src/lib/repo-router.ts`
- Create: `src/lib/__tests__/repo-router.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/__tests__/repo-router.test.ts`:

```typescript
import { routeQuestion } from '@/lib/repo-router';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('repo-router', () => {
  const repos = [
    { id: 'repo-1', name: 'Billing Service', description: 'Handles invoices and payments' },
    { id: 'repo-2', name: 'Customer Portal', description: 'Frontend for customer self-service' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPENROUTER_API_KEY = 'test-key';
  });

  it('returns the repo ID chosen by the model', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'repo-1' } }],
      }),
    });

    const result = await routeQuestion('How does invoice generation work?', repos);
    expect(result).toBe('repo-1');
  });

  it('returns the single repo when only one exists', async () => {
    const result = await routeQuestion('Any question', [repos[0]]);
    expect(result).toBe('repo-1');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws when the model returns an invalid repo ID', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'nonexistent-id' } }],
      }),
    });

    await expect(routeQuestion('question', repos)).rejects.toThrow('Could not determine');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest src/lib/__tests__/repo-router.test.ts --no-coverage 2>&1
```

Expected: FAIL — `Cannot find module '@/lib/repo-router'`

- [ ] **Step 3: Implement repo-router.ts**

Create `src/lib/repo-router.ts`:

```typescript
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const ROUTING_MODEL = 'openai/gpt-4o-mini';

interface RepoOption {
  id: string;
  name: string;
  description: string;
}

/**
 * Route a user question to the best matching repository using a lightweight LLM call.
 * Returns the repository ID.
 */
export async function routeQuestion(
  question: string,
  repos: RepoOption[],
): Promise<string> {
  // Skip routing if only one repo
  if (repos.length === 1) {
    return repos[0].id;
  }

  const repoList = repos
    .map((r) => `- id: ${r.id} | name: "${r.name}" | description: "${r.description}"`)
    .join('\n');

  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: ROUTING_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are a routing assistant. Given a user question and a list of code repositories with descriptions, pick the single best matching repository. Return ONLY the repository ID, nothing else. No explanation, no quotes, just the ID.',
        },
        {
          role: 'user',
          content: `Repositories:\n${repoList}\n\nQuestion: "${question}"`,
        },
      ],
      max_tokens: 100,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Routing API failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const chosenId = data.choices?.[0]?.message?.content?.trim();

  // Validate the returned ID exists in our repo list
  const match = repos.find((r) => r.id === chosenId);
  if (!match) {
    console.error(`[router] Model returned invalid repo ID: "${chosenId}". Valid IDs: ${repos.map((r) => r.id).join(', ')}`);
    throw new Error('Could not determine which repository to use for this question.');
  }

  return match.id;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest src/lib/__tests__/repo-router.test.ts --no-coverage 2>&1
```

Expected: PASS — all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/repo-router.ts src/lib/__tests__/repo-router.test.ts
git commit -m "feat: add question router using OpenRouter for repo selection"
```

---

## Task 8: Update Session Manager

**Files:**
- Modify: `src/lib/session-manager.ts`

- [ ] **Step 1: Add `repoPath` parameter to `startSession`**

In `src/lib/session-manager.ts`, change `startSession` (line 45) to accept a `repoPath` parameter instead of reading from `config.repoPath`:

Replace the current `startSession` method:

```typescript
  startSession(requestId: string, message: string, systemPrompt: string, claudeToken: string, userId: string): ChildProcess | Promise<ChildProcess> {
    const args = [
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--max-turns', String(config.claudeMaxTurns),
      '--add-dir', config.repoPath,
      '--system-prompt', systemPrompt,
      '--mcp-config', getMcpConfig(),
      '--permission-mode', 'bypassPermissions',
    ];

    return this.spawnOrQueue(requestId, args, message, claudeToken, userId);
  }
```

With:

```typescript
  startSession(requestId: string, message: string, systemPrompt: string, claudeToken: string, userId: string, repoPath: string): ChildProcess | Promise<ChildProcess> {
    const args = [
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--max-turns', String(config.claudeMaxTurns),
      '--add-dir', repoPath,
      '--system-prompt', systemPrompt,
      '--mcp-config', getMcpConfig(),
      '--permission-mode', 'bypassPermissions',
    ];

    return this.spawnOrQueue(requestId, args, message, claudeToken, userId);
  }
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -10
```

Expected: Build may show errors in `chat/route.ts` because call sites need updating — that's expected and fixed in Task 9.

- [ ] **Step 3: Commit**

```bash
git add src/lib/session-manager.ts
git commit -m "feat: accept repoPath parameter in SessionManager.startSession"
```

---

## Task 9: Integrate Routing into Chat Flow

**Files:**
- Modify: `src/app/api/chat/route.ts`

This is the core integration. The chat route needs to:
1. Fetch active repos
2. Route the question to a repo (or use existing repo on resume)
3. Pass the repo path to session manager
4. Store `repositoryId` on the conversation
5. Include repo context in system prompt

- [ ] **Step 1: Add imports and routing logic**

At the top of `src/app/api/chat/route.ts`, add the import (after the existing imports at line 9):

```typescript
import { routeQuestion } from '@/lib/repo-router';
```

- [ ] **Step 2: Add repo resolution after conversation lookup**

After the conversation lookup/creation block (around line 80, after the attachment handling), add the repo resolution logic. Insert before the `knowledgeEntries` fetch:

```typescript
  // --- Repo routing ---
  let repoPath = config.repoPath; // fallback to legacy single-repo
  let repositoryId: string | null = null;

  if (conversation.claudeSessionId && conversationId) {
    // Resuming: use the repo already linked to this conversation
    const existingConv = await prisma.conversation.findUnique({
      where: { id: conversation.id },
      select: { repositoryId: true, repository: { select: { localPath: true, name: true, description: true, lastPulledAt: true } } },
    });
    if (existingConv?.repository) {
      repoPath = existingConv.repository.localPath;
      repositoryId = existingConv.repositoryId;
    }
  } else {
    // New conversation: route to the best repo
    const activeRepos = await prisma.repository.findMany({
      where: { active: true },
      select: { id: true, name: true, description: true, localPath: true, lastPulledAt: true },
    });

    if (activeRepos.length > 0) {
      try {
        const chosenId = await routeQuestion(message, activeRepos);
        const chosen = activeRepos.find((r) => r.id === chosenId);
        if (chosen) {
          repoPath = chosen.localPath;
          repositoryId = chosen.id;

          // Link conversation to repo
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { repositoryId: chosen.id },
          });
        }
      } catch (err) {
        console.error('[chat] Routing failed, using fallback:', (err as Error).message);
      }
    }
  }

  // Get repo info for system prompt context
  let repoContext = '';
  if (repositoryId) {
    const repo = await prisma.repository.findUnique({
      where: { id: repositoryId },
      select: { name: true, description: true, lastPulledAt: true },
    });
    if (repo) {
      repoContext = `\n\nYou are answering questions about the "${repo.name}" codebase: ${repo.description}`;
      if (repo.lastPulledAt) {
        repoContext += `\nCode last synced: ${repo.lastPulledAt.toISOString()}`;
      }
      repoContext += `\nIf a knowledge entry contradicts what you see in the current code, trust the code — the entry may be outdated. Use save_knowledge to save an updated correction.`;
    }
  }
```

- [ ] **Step 3: Inject repo context into system prompt**

After the existing `systemPrompt += knowledgeBlock;` line, add:

```typescript
  systemPrompt += repoContext;
```

- [ ] **Step 4: Update the knowledge entry formatting to show repo source**

In the knowledge block builder (around line 130), update the entry formatting to include repo provenance. Change:

```typescript
      for (const entry of entries) {
        knowledgeBlock += `- ${entry.content}\n`;
      }
```

To (requires updating the entries type to include repository name — see Task 10):

```typescript
      for (const entry of entries) {
        const source = (entry as any).repositoryName ? `[from: ${(entry as any).repositoryName}]` : '[global]';
        knowledgeBlock += `- ${source} ${entry.content}\n`;
      }
```

- [ ] **Step 5: Update session spawn calls to pass repoPath**

At the bottom of the `start(controller)` function (around line 340-355), update both `startSession` and the retry `startSession` calls to pass `repoPath`:

Change:

```typescript
      const procOrPromise = conversation.claudeSessionId
        ? sessionManager.resumeSession(requestId, conversation.claudeSessionId, cliMessage, userClaudeToken, userId)
        : sessionManager.startSession(requestId, cliMessage, systemPrompt, userClaudeToken, userId);
```

To:

```typescript
      const procOrPromise = conversation.claudeSessionId
        ? sessionManager.resumeSession(requestId, conversation.claudeSessionId, cliMessage, userClaudeToken, userId)
        : sessionManager.startSession(requestId, cliMessage, systemPrompt, userClaudeToken, userId, repoPath);
```

Also update the retry block inside `attachProcess` (around line 295) from:

```typescript
                    : sessionManager.startSession(retryRequestId, cliMessage, systemPrompt, userClaudeToken, userId);
```

To:

```typescript
                    : sessionManager.startSession(retryRequestId, cliMessage, systemPrompt, userClaudeToken, userId, repoPath);
```

- [ ] **Step 6: Verify build**

```bash
npm run build 2>&1 | tail -10
```

Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat: integrate repo routing into chat flow with system prompt context"
```

---

## Task 10: Knowledge Attribution

**Files:**
- Modify: `src/app/api/knowledge/route.ts`
- Modify: `src/lib/embeddings.ts`
- Modify: `src/mcp/knowledge-server.mjs`
- Modify: `src/lib/session-manager.ts`

- [ ] **Step 1: Accept `repositoryId` in knowledge POST route**

In `src/app/api/knowledge/route.ts`, update the POST handler body destructuring (around line 16):

Change:

```typescript
  const { category, content, tags, source } = body as {
    category: string;
    content: string;
    tags?: string;
    source?: string;
  };
```

To:

```typescript
  const { category, content, tags, source, repositoryId } = body as {
    category: string;
    content: string;
    tags?: string;
    source?: string;
    repositoryId?: string;
  };
```

And update the `prisma.knowledgeEntry.create` call (around line 53):

Change:

```typescript
  const entry = await prisma.knowledgeEntry.create({
    data: { category, content, tags: tags || '', source },
  });
```

To:

```typescript
  const entry = await prisma.knowledgeEntry.create({
    data: { category, content, tags: tags || '', source, repositoryId: repositoryId || null },
  });
```

- [ ] **Step 2: Include repository name in GET results**

In the GET handler, update the query to include the repository relation. Change the `findMany` calls:

```typescript
  const entries = await prisma.knowledgeEntry.findMany({
    where: isAdmin ? {} : { category: { not: 'developer' } },
    orderBy: { createdAt: 'desc' },
    include: { repository: { select: { name: true } } },
  });
```

- [ ] **Step 3: Include repository name in `findRelevantEntries` results**

In `src/lib/embeddings.ts`, update the `KnowledgeEntryResult` interface and raw queries to include `repositoryName`.

Update the interface:

```typescript
interface KnowledgeEntryResult {
  id: string;
  category: string;
  content: string;
  tags: string;
  source: string | null;
  createdAt: Date;
  repositoryName: string | null;
}
```

Update the corrections query:

```typescript
  const corrections: KnowledgeEntryResult[] = await prisma.$queryRaw`
    SELECT ke.id, ke.category, ke.content, ke.tags, ke.source, ke."createdAt", r.name as "repositoryName"
    FROM "KnowledgeEntry" ke
    LEFT JOIN "Repository" r ON ke."repositoryId" = r.id
    WHERE ke.category = 'correction'
  `;
```

Update the semantic results query:

```typescript
  const semanticResults: KnowledgeEntryResult[] = await prisma.$queryRaw`
    SELECT ke.id, ke.category, ke.content, ke.tags, ke.source, ke."createdAt", r.name as "repositoryName"
    FROM "KnowledgeEntry" ke
    LEFT JOIN "Repository" r ON ke."repositoryId" = r.id
    WHERE ke.embedding IS NOT NULL
    AND ke.category != 'correction'
    ORDER BY ke.embedding <=> ${vectorStr}::vector
    LIMIT ${remainingSlots}
  `;
```

- [ ] **Step 4: Pass `repositoryId` through MCP config**

In `src/lib/session-manager.ts`, update `getMcpConfig()` to accept an optional `repositoryId` parameter:

Change signature from:

```typescript
function getMcpConfig(): string {
```

To:

```typescript
function getMcpConfig(repositoryId?: string): string {
```

And add `REPOSITORY_ID` to the env block:

```typescript
        env: {
          KNOWLEDGE_API_URL: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/knowledge`,
          KNOWLEDGE_SEARCH_URL: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/knowledge/search`,
          KNOWLEDGE_API_SECRET: process.env.KNOWLEDGE_API_SECRET || '',
          REPOSITORY_ID: repositoryId || '',
        },
```

Update `startSession` to pass `repositoryId` (add it as a 7th parameter):

Change signature:

```typescript
  startSession(requestId: string, message: string, systemPrompt: string, claudeToken: string, userId: string, repoPath: string): ChildProcess | Promise<ChildProcess> {
```

To:

```typescript
  startSession(requestId: string, message: string, systemPrompt: string, claudeToken: string, userId: string, repoPath: string, repositoryId?: string): ChildProcess | Promise<ChildProcess> {
```

And update the `--mcp-config` arg:

```typescript
      '--mcp-config', getMcpConfig(repositoryId),
```

- [ ] **Step 5: Use `REPOSITORY_ID` in knowledge-server.mjs**

In `src/mcp/knowledge-server.mjs`, find the `save_knowledge` tool call handler. Add `repositoryId` to the POST body. Find the fetch call in the save handler and add it:

At the top of the file, add:

```javascript
const REPOSITORY_ID = process.env.REPOSITORY_ID || '';
```

In the save_knowledge handler, update the fetch body to include:

```javascript
body: JSON.stringify({
  category: args.category,
  content: args.content,
  tags: args.tags || '',
  source: args.source || '',
  repositoryId: REPOSITORY_ID || undefined,
}),
```

- [ ] **Step 6: Update chat route to pass `repositoryId` to `startSession`**

In `src/app/api/chat/route.ts`, update the `startSession` call:

```typescript
        : sessionManager.startSession(requestId, cliMessage, systemPrompt, userClaudeToken, userId, repoPath, repositoryId || undefined);
```

And the retry call:

```typescript
                    : sessionManager.startSession(retryRequestId, cliMessage, systemPrompt, userClaudeToken, userId, repoPath, repositoryId || undefined);
```

- [ ] **Step 7: Verify build**

```bash
npm run build 2>&1 | tail -10
```

Expected: Build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/knowledge/route.ts src/lib/embeddings.ts src/mcp/knowledge-server.mjs src/lib/session-manager.ts src/app/api/chat/route.ts
git commit -m "feat: add repository attribution to knowledge entries"
```

---

## Task 11: Sync Script

**Files:**
- Create: `scripts/sync-repos.ts`

- [ ] **Step 1: Create the sync script**

Create `scripts/sync-repos.ts`:

```typescript
/**
 * Periodic repo sync script.
 * Run on cron (e.g. every 10 minutes): npx tsx scripts/sync-repos.ts
 *
 * Pulls latest changes for all active repositories and updates lastPulledAt.
 * Repos are made read-only after each pull.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { syncRepo } from '../src/lib/repo-manager';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

async function main() {
  const token = process.env.GITLAB_TOKEN;
  if (!token) {
    console.error('[sync] GITLAB_TOKEN not set');
    process.exit(1);
  }

  const repos = await prisma.repository.findMany({
    where: { active: true },
  });

  console.log(`[sync] Found ${repos.length} active repos to sync`);

  for (const repo of repos) {
    try {
      console.log(`[sync] Syncing ${repo.name} (${repo.gitlabProjectId})...`);

      await syncRepo({
        localPath: repo.localPath,
        branch: repo.defaultBranch,
        token,
        gitlabUrl: repo.gitlabUrl,
      });

      await prisma.repository.update({
        where: { id: repo.id },
        data: { lastPulledAt: new Date() },
      });

      console.log(`[sync] ${repo.name} synced successfully`);
    } catch (err) {
      console.error(`[sync] Failed to sync ${repo.name}:`, (err as Error).message);
    }
  }

  console.log('[sync] Done');
}

main()
  .catch((err) => {
    console.error('[sync] Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsx --eval "import './scripts/sync-repos'" 2>&1 | head -5
```

Expected: No syntax errors (will fail at runtime without DB, that's fine).

- [ ] **Step 3: Commit**

```bash
git add scripts/sync-repos.ts
git commit -m "feat: add periodic repo sync script for cron execution"
```

---

## Task 12: Cleanup — Remove Old Webhook, SSH, and Update Env

**Files:**
- Delete: `src/app/api/webhook/gitlab/route.ts`
- Delete: `src/lib/git-pull.ts`
- Modify: `.env.example`
- Modify: `docker-entrypoint.sh`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Delete old webhook route and git-pull utility**

```bash
rm src/app/api/webhook/gitlab/route.ts
rm src/lib/git-pull.ts
# Remove the webhook directory if empty
rmdir src/app/api/webhook/gitlab 2>/dev/null
rmdir src/app/api/webhook 2>/dev/null
```

- [ ] **Step 2: Remove git-pull import if referenced elsewhere**

Search for any remaining references:

```bash
grep -r "git-pull" src/ --include="*.ts" --include="*.tsx"
```

Expected: No results (only the webhook route imported it, which was just deleted).

- [ ] **Step 3: Remove SSH keyscan from docker-entrypoint.sh**

We no longer use SSH for git — all clones use HTTPS with token auth. Also update the single `/app/repo` chown to use `REPOS_DIR`.

In `docker-entrypoint.sh`, remove the SSH block (lines 11-14):

```sh
# Ensure SSH known hosts exist for git operations
if [ -d /home/nextjs/.ssh ] && [ ! -f /home/nextjs/.ssh/known_hosts ]; then
  su-exec nextjs ssh-keyscan gitlab.com >> /home/nextjs/.ssh/known_hosts 2>/dev/null
fi
```

And replace the single-repo chown (line 5):

```sh
chown -R nextjs:nodejs /app/repo
```

With multi-repo support:

```sh
# Fix ownership of repos directory
if [ -d "${REPOS_DIR:-/app/repos}" ]; then
  chown -R nextjs:nodejs "${REPOS_DIR:-/app/repos}"
fi
```

The final `docker-entrypoint.sh` should be:

```sh
#!/bin/sh
set -e

# Fix ownership of repos directory
if [ -d "${REPOS_DIR:-/app/repos}" ]; then
  chown -R nextjs:nodejs "${REPOS_DIR:-/app/repos}"
fi

# Ensure uploads directory exists and is writable
mkdir -p /app/uploads
chown -R nextjs:nodejs /app/uploads

echo "Syncing database schema..."
su-exec nextjs npx prisma db push

echo "Starting server..."
exec su-exec nextjs node server.js
```

- [ ] **Step 4: Remove SSH volume mount from docker-compose.yml**

In `docker-compose.yml`, remove the SSH mount (line 27):

```yaml
      - ~/.ssh:/home/nextjs/.ssh:ro
```

And replace the single `repo` volume with `repos`:

Change:

```yaml
    volumes:
      - repo:/app/repo
      - claude-sessions:/app/claude-sessions
      - ~/.ssh:/home/nextjs/.ssh:ro
      - ./uploads:/app/uploads
```

To:

```yaml
    volumes:
      - repos:/app/repos
      - claude-sessions:/app/claude-sessions
      - ./uploads:/app/uploads
    environment:
      - SESSIONS_DIR=/app/claude-sessions
      - UPLOAD_PATH=/app/uploads
      - REPOS_DIR=/app/repos
```

And update the volumes section at the bottom:

Change `repo:` to `repos:`.

- [ ] **Step 5: Update `.env.example`**

Replace the GitLab webhook section and add new vars. Change:

```
# GitLab webhook
# GITLAB_WEBHOOK_SECRET=your-gitlab-webhook-secret
```

To:

```
# GitLab integration (multi-repo)
# GITLAB_TOKEN=glpat-your-gitlab-personal-access-token
# REPOS_DIR=/data/repos
```

Mark `REPO_PATH` as legacy/fallback:

```
# Legacy single-repo fallback (used if no repos configured in admin)
REPO_PATH=/path/to/your/codebase
```

- [ ] **Step 6: Update `src/lib/CLAUDE.md`**

Replace the `git-pull.ts` entry:

Change:

```
- `git-pull.ts` — Git pull utility for repo updates.
```

To:

```
- `repo-manager.ts` — Clone, sync, and enforce read-only permissions on GitLab repositories.
- `repo-router.ts` — Route user questions to the best matching repository via OpenRouter.
```

- [ ] **Step 7: Verify build**

```bash
npm run build 2>&1 | tail -10
```

Expected: Build succeeds.

- [ ] **Step 8: Run all tests**

```bash
npm test 2>&1
```

Expected: All tests pass.

- [ ] **Step 9: Verify no SSH or webhook references remain**

```bash
grep -ri "ssh" src/ docker-entrypoint.sh docker-compose.yml --include="*.ts" --include="*.tsx" --include="*.sh" --include="*.yml"
grep -r "webhook/gitlab" src/ --include="*.ts" --include="*.tsx"
grep -r "git-pull" src/ --include="*.ts" --include="*.tsx"
grep -r "GITLAB_WEBHOOK_SECRET" . --include="*.ts" --include="*.tsx" --include="*.env*"
```

Expected: No results for any of these.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: remove SSH, old GitLab webhook, update Docker for multi-repo"
```

---

## Task 13: Final Verification

- [ ] **Step 1: Full build check**

```bash
npm run build 2>&1
```

Expected: Build succeeds with no errors.

- [ ] **Step 2: Full test suite**

```bash
npm test 2>&1
```

Expected: All tests pass.

- [ ] **Step 3: Push branch**

```bash
git push origin feature/gitlab-integration
```
