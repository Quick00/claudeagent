# GitLab Webhook Repo Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a webhook endpoint that GitLab calls on push events to `git pull` the repo inside the container.

**Architecture:** A single POST endpoint `/api/webhook/gitlab` validates a shared secret from the `X-Gitlab-Token` header, acquires an in-memory lock to prevent concurrent pulls, and shells out to `git pull` on `REPO_PATH`. The endpoint is added to public routes so it bypasses JWT auth.

**Tech Stack:** Next.js 16 App Router API route, Node.js `child_process.exec`, Jest for testing.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/git-pull.ts` | Create | Core git pull logic with locking — pure function, no HTTP concerns |
| `src/app/api/webhook/gitlab/route.ts` | Create | HTTP layer: header validation, calls git pull, returns response |
| `src/proxy.ts` | Modify | Add webhook route to public paths |
| `.env.example` | Modify | Document `GITLAB_WEBHOOK_SECRET` |
| `__tests__/lib/git-pull.test.ts` | Create | Unit tests for git pull logic |
| `__tests__/api/webhook-gitlab.test.ts` | Create | Integration tests for webhook endpoint |

---

### Task 1: Git pull module with locking

**Files:**
- Create: `src/lib/git-pull.ts`
- Create: `__tests__/lib/git-pull.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/lib/git-pull.test.ts
import { execGitPull, isPullInProgress } from '@/lib/git-pull';
import { exec } from 'child_process';

jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

const mockExec = exec as unknown as jest.Mock;

describe('execGitPull', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('runs git pull on the given repo path', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(null, 'Already up to date.\n', '');
    });

    const result = await execGitPull('/repo');

    expect(mockExec).toHaveBeenCalledWith(
      'git pull',
      { cwd: '/repo' },
      expect.any(Function)
    );
    expect(result).toEqual({ success: true, output: 'Already up to date.\n' });
  });

  it('returns error when git pull fails', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(new Error('merge conflict'), '', 'error output');
    });

    const result = await execGitPull('/repo');

    expect(result).toEqual({ success: false, error: 'merge conflict' });
  });

  it('rejects concurrent pulls', async () => {
    let resolveFirst: Function;
    mockExec.mockImplementationOnce((_cmd: string, _opts: unknown, cb: Function) => {
      resolveFirst = () => cb(null, 'done', '');
    });

    const first = execGitPull('/repo');
    expect(isPullInProgress()).toBe(true);

    const second = await execGitPull('/repo');
    expect(second).toEqual({ success: false, error: 'Pull already in progress' });

    resolveFirst!();
    await first;
    expect(isPullInProgress()).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/git-pull.test.ts --no-cache`
Expected: FAIL — module `@/lib/git-pull` does not exist

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/git-pull.ts
import { exec } from 'child_process';

let pullInProgress = false;

export type PullResult =
  | { success: true; output: string }
  | { success: false; error: string };

export function isPullInProgress(): boolean {
  return pullInProgress;
}

export function execGitPull(repoPath: string): Promise<PullResult> {
  if (pullInProgress) {
    return Promise.resolve({ success: false, error: 'Pull already in progress' });
  }

  pullInProgress = true;

  return new Promise((resolve) => {
    exec('git pull', { cwd: repoPath }, (error, stdout, _stderr) => {
      pullInProgress = false;
      if (error) {
        resolve({ success: false, error: error.message });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/git-pull.test.ts --no-cache`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/git-pull.ts __tests__/lib/git-pull.test.ts
git commit -m "feat: add git pull module with concurrency lock"
```

---

### Task 2: Webhook API route

**Files:**
- Create: `src/app/api/webhook/gitlab/route.ts`
- Create: `__tests__/api/webhook-gitlab.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/api/webhook-gitlab.test.ts
import { POST } from '@/app/api/webhook/gitlab/route';
import { execGitPull } from '@/lib/git-pull';

jest.mock('@/lib/git-pull');

const mockExecGitPull = execGitPull as jest.Mock;

function makeRequest(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/webhook/gitlab', {
    method: 'POST',
    headers,
  });
}

describe('POST /api/webhook/gitlab', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      GITLAB_WEBHOOK_SECRET: 'test-secret',
      REPO_PATH: '/repo',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns 401 when X-Gitlab-Token is missing', async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 401 when X-Gitlab-Token is wrong', async () => {
    const res = await POST(makeRequest({ 'X-Gitlab-Token': 'wrong' }));
    expect(res.status).toBe(401);
  });

  it('returns 200 on successful pull', async () => {
    mockExecGitPull.mockResolvedValue({ success: true, output: 'Already up to date.\n' });

    const res = await POST(makeRequest({ 'X-Gitlab-Token': 'test-secret' }));

    expect(res.status).toBe(200);
    expect(mockExecGitPull).toHaveBeenCalledWith('/repo');
  });

  it('returns 409 when pull is already in progress', async () => {
    mockExecGitPull.mockResolvedValue({ success: false, error: 'Pull already in progress' });

    const res = await POST(makeRequest({ 'X-Gitlab-Token': 'test-secret' }));

    expect(res.status).toBe(409);
  });

  it('returns 500 when pull fails', async () => {
    mockExecGitPull.mockResolvedValue({ success: false, error: 'merge conflict' });

    const res = await POST(makeRequest({ 'X-Gitlab-Token': 'test-secret' }));

    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/api/webhook-gitlab.test.ts --no-cache`
Expected: FAIL — module `@/app/api/webhook/gitlab/route` does not exist

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/api/webhook/gitlab/route.ts
import { NextResponse } from 'next/server';
import { execGitPull } from '@/lib/git-pull';

export async function POST(request: Request) {
  const token = request.headers.get('X-Gitlab-Token');
  const secret = process.env.GITLAB_WEBHOOK_SECRET;

  if (!token || token !== secret) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const repoPath = process.env.REPO_PATH;
  if (!repoPath) {
    return NextResponse.json({ error: 'REPO_PATH not configured' }, { status: 500 });
  }

  const result = await execGitPull(repoPath);

  if (!result.success) {
    if (result.error === 'Pull already in progress') {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ message: 'Pull successful', output: result.output });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/api/webhook-gitlab.test.ts --no-cache`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/webhook/gitlab/route.ts __tests__/api/webhook-gitlab.test.ts
git commit -m "feat: add GitLab webhook endpoint for repo sync"
```

---

### Task 3: Middleware and config updates

**Files:**
- Modify: `src/proxy.ts:19` (add webhook to public matcher)
- Modify: `.env.example` (add `GITLAB_WEBHOOK_SECRET`)

- [ ] **Step 1: Update middleware matcher**

In `src/proxy.ts`, the `config.matcher` array currently is:
```typescript
matcher: ['/', '/api/chat/:path*', '/api/conversations/:path*', '/api/auth/claude/:path*'],
```

The webhook route `/api/webhook/gitlab` is NOT in this list, which means the middleware won't run on it — so it's already effectively public. **No change needed to `src/proxy.ts`.**

(The middleware only protects routes listed in `matcher`. Since `/api/webhook/gitlab` is not matched, it passes through without JWT validation. The route itself validates the webhook secret.)

- [ ] **Step 2: Add env variable to .env.example**

Append to `.env.example` after the existing optional section:

```
# GitLab webhook
# GITLAB_WEBHOOK_SECRET=your-gitlab-webhook-secret
```

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs: add GITLAB_WEBHOOK_SECRET to env example"
```

---

### Task 4: Run full test suite and verify

- [ ] **Step 1: Run all tests**

Run: `npx jest --no-cache`
Expected: All tests pass, no regressions

- [ ] **Step 2: Manual smoke test (optional)**

Start the dev server and test with curl:
```bash
# Should return 401
curl -X POST http://localhost:3000/api/webhook/gitlab

# Should return 200 (if REPO_PATH is a valid git repo and GITLAB_WEBHOOK_SECRET is set)
curl -X POST http://localhost:3000/api/webhook/gitlab \
  -H "X-Gitlab-Token: your-secret"
```
