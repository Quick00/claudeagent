# Claude Account Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require each user to link their own Claude subscription via OAuth PKCE before using the chat, so usage is billed to their own account.

**Architecture:** Add OAuth PKCE flow against Anthropic's endpoints (`claude.ai/oauth/authorize` + `console.anthropic.com/v1/oauth/token`). Store encrypted tokens per user in SQLite. Pass `CLAUDE_CODE_OAUTH_TOKEN` env var when spawning CLI sessions. Block chat access until linked.

**Tech Stack:** Next.js 16 App Router, Prisma (SQLite), NextAuth.js v4, Node.js crypto (AES-256-GCM)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `prisma/schema.prisma` | Modify | Add Claude token fields to User model |
| `src/lib/crypto.ts` | Create | AES-256-GCM encrypt/decrypt for tokens |
| `src/lib/claude-oauth.ts` | Create | PKCE generation, token exchange, refresh |
| `src/app/api/auth/claude/route.ts` | Create | Initiate OAuth flow (redirect to Anthropic) |
| `src/app/api/auth/claude/callback/route.ts` | Create | Handle OAuth callback, store tokens |
| `src/app/api/auth/claude/unlink/route.ts` | Create | Clear user's Claude tokens |
| `src/app/api/auth/claude/status/route.ts` | Create | Return linked status (no tokens) |
| `src/lib/session-manager.ts` | Modify | Accept and pass user's Claude token to CLI |
| `src/app/api/chat/route.ts` | Modify | Fetch/refresh user token before spawning |
| `src/app/page.tsx` | Modify | Block chat when account not linked |
| `src/components/ChatSidebar.tsx` | Modify | Add settings link |
| `src/app/settings/page.tsx` | Create | Account settings with link/unlink UI |
| `src/proxy.ts` | Modify | Allow `/api/auth/claude/callback` without auth redirect |
| `src/__tests__/crypto.test.ts` | Create | Tests for encrypt/decrypt |
| `src/__tests__/claude-oauth.test.ts` | Create | Tests for PKCE, token exchange, refresh |

---

### Task 1: Prisma Schema — Add Claude Token Fields

**Files:**
- Modify: `prisma/schema.prisma:9-16`

- [ ] **Step 1: Update User model**

In `prisma/schema.prisma`, replace the User model:

```prisma
model User {
  id                   String    @id @default(uuid())
  email                String    @unique
  name                 String
  image                String?
  claudeToken          String?
  claudeRefreshToken   String?
  claudeTokenExpiresAt DateTime?
  claudeEmail          String?
  createdAt            DateTime  @default(now())
  conversations        Conversation[]
}
```

- [ ] **Step 2: Generate and apply migration**

Run:
```bash
npx prisma migrate dev --name add-claude-token-fields
```

Expected: Migration created, Prisma client regenerated. No errors.

- [ ] **Step 3: Commit**

```bash
git add prisma/
git commit -m "feat: add Claude token fields to User model"
```

---

### Task 2: Encryption Utilities

**Files:**
- Create: `src/lib/crypto.ts`
- Create: `src/__tests__/crypto.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/crypto.test.ts`:

```typescript
import { encrypt, decrypt } from '@/lib/crypto';

describe('crypto', () => {
  // Set a test encryption key (32 bytes hex = 64 chars)
  beforeAll(() => {
    process.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
  });

  it('encrypts and decrypts a string', () => {
    const plaintext = 'my-secret-token-12345';
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertext each time (random IV)', () => {
    const plaintext = 'same-input';
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toBe(b);
  });

  it('throws on tampered ciphertext', () => {
    const encrypted = encrypt('test');
    const tampered = encrypted.slice(0, -4) + 'AAAA';
    expect(() => decrypt(tampered)).toThrow();
  });

  it('throws when TOKEN_ENCRYPTION_KEY is missing', () => {
    const saved = process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encrypt('test')).toThrow('TOKEN_ENCRYPTION_KEY');
    process.env.TOKEN_ENCRYPTION_KEY = saved;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/crypto.test.ts`
Expected: FAIL — `Cannot find module '@/lib/crypto'`

- [ ] **Step 3: Write implementation**

Create `src/lib/crypto.ts`:

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

function getKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: base64(iv + ciphertext + authTag)
  return Buffer.concat([iv, encrypted, authTag]).toString('base64');
}

export function decrypt(ciphertext: string): string {
  const key = getKey();
  const buf = Buffer.from(ciphertext, 'base64');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(buf.length - 16);
  const encrypted = buf.subarray(12, buf.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/crypto.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/crypto.ts src/__tests__/crypto.test.ts
git commit -m "feat: add AES-256-GCM encryption utilities for token storage"
```

---

### Task 3: Claude OAuth Helpers

**Files:**
- Create: `src/lib/claude-oauth.ts`
- Create: `src/__tests__/claude-oauth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/claude-oauth.test.ts`:

```typescript
import { generatePKCE, buildAuthorizeUrl, exchangeCodeForTokens, refreshAccessToken } from '@/lib/claude-oauth';

describe('claude-oauth', () => {
  describe('generatePKCE', () => {
    it('returns a verifier and challenge', async () => {
      const { verifier, challenge } = await generatePKCE();
      expect(verifier).toBeTruthy();
      expect(challenge).toBeTruthy();
      expect(verifier.length).toBeGreaterThan(40);
      expect(challenge).not.toBe(verifier);
    });

    it('produces URL-safe base64 (no +, /, =)', async () => {
      const { verifier, challenge } = await generatePKCE();
      const unsafeChars = /[+/=]/;
      expect(unsafeChars.test(verifier)).toBe(false);
      expect(unsafeChars.test(challenge)).toBe(false);
    });
  });

  describe('buildAuthorizeUrl', () => {
    it('builds correct URL with all params', () => {
      const url = buildAuthorizeUrl({
        codeChallenge: 'test-challenge',
        state: 'test-state',
        redirectUri: 'http://localhost:3000/api/auth/claude/callback',
      });
      const parsed = new URL(url);
      expect(parsed.origin).toBe('https://claude.ai');
      expect(parsed.pathname).toBe('/oauth/authorize');
      expect(parsed.searchParams.get('code_challenge')).toBe('test-challenge');
      expect(parsed.searchParams.get('state')).toBe('test-state');
      expect(parsed.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/auth/claude/callback');
      expect(parsed.searchParams.get('response_type')).toBe('code');
      expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
      expect(parsed.searchParams.get('scope')).toBe('user:inference');
    });
  });

  describe('exchangeCodeForTokens', () => {
    it('sends correct request and parses response', async () => {
      const mockResponse = {
        access_token: 'access-123',
        refresh_token: 'refresh-456',
        expires_in: 28800,
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await exchangeCodeForTokens({
        code: 'auth-code',
        codeVerifier: 'verifier-abc',
        redirectUri: 'http://localhost:3000/api/auth/claude/callback',
      });

      expect(result.accessToken).toBe('access-123');
      expect(result.refreshToken).toBe('refresh-456');
      expect(result.expiresIn).toBe(28800);

      const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://console.anthropic.com/v1/oauth/token');
      expect(options.method).toBe('POST');
      const body = new URLSearchParams(options.body);
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code')).toBe('auth-code');
      expect(body.get('code_verifier')).toBe('verifier-abc');
    });

    it('throws on non-ok response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad Request'),
      });

      await expect(
        exchangeCodeForTokens({
          code: 'bad-code',
          codeVerifier: 'verifier',
          redirectUri: 'http://localhost:3000/api/auth/claude/callback',
        })
      ).rejects.toThrow('Token exchange failed');
    });
  });

  describe('refreshAccessToken', () => {
    it('sends refresh request and returns new tokens', async () => {
      const mockResponse = {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 28800,
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await refreshAccessToken('old-refresh-token');

      expect(result.accessToken).toBe('new-access');
      expect(result.refreshToken).toBe('new-refresh');

      const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://console.anthropic.com/v1/oauth/token');
      const body = new URLSearchParams(options.body);
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('old-refresh-token');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/claude-oauth.test.ts`
Expected: FAIL — `Cannot find module '@/lib/claude-oauth'`

- [ ] **Step 3: Write implementation**

Create `src/lib/claude-oauth.ts`:

```typescript
import { randomBytes, createHash } from 'crypto';

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';

function base64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(randomBytes(64));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function buildAuthorizeUrl(params: {
  codeChallenge: string;
  state: string;
  redirectUri: string;
}): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  url.searchParams.set('scope', 'user:inference');
  return url.toString();
}

interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export async function exchangeCodeForTokens(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    code_verifier: params.codeVerifier,
    redirect_uri: params.redirectUri,
    client_id: CLIENT_ID,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/claude-oauth.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/claude-oauth.ts src/__tests__/claude-oauth.test.ts
git commit -m "feat: add Claude OAuth PKCE helpers (authorize, exchange, refresh)"
```

---

### Task 4: OAuth Initiate Route

**Files:**
- Create: `src/app/api/auth/claude/route.ts`
- Modify: `src/proxy.ts:18-19`

- [ ] **Step 1: Create the initiate route**

Create `src/app/api/auth/claude/route.ts`:

```typescript
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomBytes } from 'crypto';
import { authOptions } from '@/lib/auth';
import { generatePKCE, buildAuthorizeUrl } from '@/lib/claude-oauth';
import { encrypt } from '@/lib/crypto';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const { verifier, challenge } = await generatePKCE();
  const state = randomBytes(32).toString('hex');

  const redirectUri = `${process.env.NEXTAUTH_URL}/api/auth/claude/callback`;

  // Store verifier and state in encrypted cookie
  const cookiePayload = JSON.stringify({ verifier, state });
  const encryptedPayload = encrypt(cookiePayload);

  const cookieStore = await cookies();
  cookieStore.set('claude_oauth', encryptedPayload, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/',
  });

  const authorizeUrl = buildAuthorizeUrl({
    codeChallenge: challenge,
    state,
    redirectUri,
  });

  return NextResponse.redirect(authorizeUrl);
}
```

- [ ] **Step 2: Update proxy matcher to allow callback without redirect loop**

In `src/proxy.ts`, update the config matcher to include the claude auth routes. The callback needs to be accessible (it will have a session cookie from the user's logged-in state, so it goes through NextAuth check fine). But we need to make sure `/api/auth/claude/callback` is in the matcher so it's protected:

Replace the matcher in `src/proxy.ts`:

```typescript
export const config = {
  matcher: ['/', '/api/chat/:path*', '/api/conversations/:path*', '/api/auth/claude/:path*'],
};
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/auth/claude/route.ts src/proxy.ts
git commit -m "feat: add OAuth initiate route for Claude account linking"
```

---

### Task 5: OAuth Callback Route

**Files:**
- Create: `src/app/api/auth/claude/callback/route.ts`

- [ ] **Step 1: Create the callback route**

Create `src/app/api/auth/claude/callback/route.ts`:

```typescript
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { authOptions } from '@/lib/auth';
import { exchangeCodeForTokens } from '@/lib/claude-oauth';
import { encrypt, decrypt } from '@/lib/crypto';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    return NextResponse.redirect(new URL(`/settings?error=${encodeURIComponent(error)}`, request.url));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL('/settings?error=missing_params', request.url));
  }

  // Retrieve and validate PKCE state from cookie
  const cookieStore = await cookies();
  const oauthCookie = cookieStore.get('claude_oauth');
  if (!oauthCookie) {
    return NextResponse.redirect(new URL('/settings?error=missing_cookie', request.url));
  }

  let verifier: string;
  let savedState: string;
  try {
    const payload = JSON.parse(decrypt(oauthCookie.value));
    verifier = payload.verifier;
    savedState = payload.state;
  } catch {
    return NextResponse.redirect(new URL('/settings?error=invalid_cookie', request.url));
  }

  if (state !== savedState) {
    return NextResponse.redirect(new URL('/settings?error=invalid_state', request.url));
  }

  // Exchange code for tokens
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/auth/claude/callback`;

  let tokens;
  try {
    tokens = await exchangeCodeForTokens({
      code,
      codeVerifier: verifier,
      redirectUri,
    });
  } catch {
    return NextResponse.redirect(new URL('/settings?error=token_exchange_failed', request.url));
  }

  // Store encrypted tokens on user record
  const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

  await prisma.user.update({
    where: { email: session.user.email },
    data: {
      claudeToken: encrypt(tokens.accessToken),
      claudeRefreshToken: encrypt(tokens.refreshToken),
      claudeTokenExpiresAt: expiresAt,
      claudeEmail: session.user.email, // Will be the Claude account email if available
    },
  });

  // Clear the OAuth cookie
  cookieStore.delete('claude_oauth');

  return NextResponse.redirect(new URL('/settings?success=linked', request.url));
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/auth/claude/callback/route.ts
git commit -m "feat: add OAuth callback route — exchanges code for tokens and stores encrypted"
```

---

### Task 6: Unlink and Status Routes

**Files:**
- Create: `src/app/api/auth/claude/unlink/route.ts`
- Create: `src/app/api/auth/claude/status/route.ts`

- [ ] **Step 1: Create the unlink route**

Create `src/app/api/auth/claude/unlink/route.ts`:

```typescript
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  await prisma.user.update({
    where: { email: session.user.email },
    data: {
      claudeToken: null,
      claudeRefreshToken: null,
      claudeTokenExpiresAt: null,
      claudeEmail: null,
    },
  });

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Create the status route**

Create `src/app/api/auth/claude/status/route.ts`:

```typescript
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { claudeEmail: true, claudeToken: true },
  });

  return NextResponse.json({
    linked: !!user?.claudeToken,
    email: user?.claudeEmail ?? null,
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/auth/claude/unlink/route.ts src/app/api/auth/claude/status/route.ts
git commit -m "feat: add Claude account unlink and status API routes"
```

---

### Task 7: Session Manager — Accept User Token

**Files:**
- Modify: `src/lib/session-manager.ts:40-55, 57-69, 88-96, 98-107`

- [ ] **Step 1: Update SessionManager to accept and pass token**

Replace the full content of `src/lib/session-manager.ts`:

```typescript
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { config } from '@/lib/config';

const PROJECT_ROOT = path.resolve(process.cwd());

function getMcpConfig(): string {
  return JSON.stringify({
    mcpServers: {
      knowledge: {
        command: 'node',
        args: [path.join(PROJECT_ROOT, 'src/mcp/knowledge-server.mjs')],
        env: {
          KNOWLEDGE_API_URL: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/knowledge`,
          KNOWLEDGE_API_SECRET: process.env.KNOWLEDGE_API_SECRET || '',
        },
      },
    },
  });
}

interface QueuedRequest {
  resolve: (proc: ChildProcess) => void;
  args: string[];
  message: string;
  claudeToken: string;
}

export class SessionManager {
  private activeProcesses = new Map<string, ChildProcess>();
  private queue: QueuedRequest[] = [];

  get activeCount(): number {
    return this.activeProcesses.size;
  }

  get queueSize(): number {
    return this.queue.length;
  }

  startSession(requestId: string, message: string, systemPrompt: string, claudeToken: string): ChildProcess | Promise<ChildProcess> {
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

    return this.spawnOrQueue(requestId, args, message, claudeToken);
  }

  resumeSession(requestId: string, claudeSessionId: string, message: string, claudeToken: string): ChildProcess | Promise<ChildProcess> {
    const args = [
      '--resume', claudeSessionId,
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--mcp-config', getMcpConfig(),
      '--permission-mode', 'bypassPermissions',
    ];

    return this.spawnOrQueue(requestId, args, message, claudeToken);
  }

  killSession(requestId: string): void {
    const proc = this.activeProcesses.get(requestId);
    if (proc) {
      proc.kill('SIGTERM');
      this.activeProcesses.delete(requestId);
      this.processQueue();
    }
  }

  killAll(): void {
    for (const [id, proc] of this.activeProcesses) {
      proc.kill('SIGTERM');
    }
    this.activeProcesses.clear();
    this.queue = [];
  }

  private spawnOrQueue(requestId: string, args: string[], message: string, claudeToken: string): ChildProcess | Promise<ChildProcess> {
    if (this.activeProcesses.size < config.maxConcurrentSessions) {
      return this.doSpawn(requestId, args, message, claudeToken);
    }

    return new Promise<ChildProcess>((resolve) => {
      this.queue.push({ resolve, args, message, claudeToken });
    });
  }

  private doSpawn(requestId: string, args: string[], message: string, claudeToken: string): ChildProcess {
    console.log(`[session-manager] Spawning claude process (requestId=${requestId}, active=${this.activeProcesses.size}, queued=${this.queue.length})`);
    console.log(`[session-manager] Args: claude ${args.join(' ')}`);
    console.log(`[session-manager] Message: ${message.slice(0, 100)}${message.length > 100 ? '...' : ''}`);

    const proc = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: config.repoPath,
      env: {
        ...process.env,
        CLAUDE_CODE_OAUTH_TOKEN: claudeToken,
      },
    });

    console.log(`[session-manager] Process spawned (pid=${proc.pid})`);

    this.activeProcesses.set(requestId, proc);

    proc.stdin!.write(message);
    proc.stdin!.end();

    proc.on('close', (code, signal) => {
      console.log(`[session-manager] Process closed (pid=${proc.pid}, code=${code}, signal=${signal}, requestId=${requestId})`);
      this.activeProcesses.delete(requestId);
      this.processQueue();
    });

    proc.on('error', (err) => {
      console.error(`[session-manager] Process error (pid=${proc.pid}, requestId=${requestId}):`, err.message);
      this.activeProcesses.delete(requestId);
      this.processQueue();
    });

    return proc;
  }

  private processQueue(): void {
    if (this.queue.length === 0) return;
    if (this.activeProcesses.size >= config.maxConcurrentSessions) return;

    const next = this.queue.shift()!;
    const requestId = `queued-${Date.now()}`;
    const proc = this.doSpawn(requestId, next.args, next.message, next.claudeToken);
    next.resolve(proc);
  }
}

export const sessionManager = new SessionManager();
```

- [ ] **Step 2: Verify the app still compiles**

Run: `npx next build 2>&1 | tail -20` (or `npx tsc --noEmit`)
Expected: No type errors related to session-manager. (The chat route will have errors since it doesn't pass the token yet — that's Task 8.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/session-manager.ts
git commit -m "feat: session manager accepts per-user Claude token and passes as env var"
```

---

### Task 8: Chat Route — Fetch and Refresh User Token

**Files:**
- Modify: `src/app/api/chat/route.ts`

- [ ] **Step 1: Update the chat route to fetch and pass user token**

Replace the full content of `src/app/api/chat/route.ts`:

```typescript
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { sessionManager } from '@/lib/session-manager';
import { config } from '@/lib/config';
import { decrypt, encrypt } from '@/lib/crypto';
import { refreshAccessToken } from '@/lib/claude-oauth';

async function getUserClaudeToken(userEmail: string): Promise<{ token: string } | { error: string; status: number }> {
  const user = await prisma.user.findUnique({
    where: { email: userEmail },
    select: {
      claudeToken: true,
      claudeRefreshToken: true,
      claudeTokenExpiresAt: true,
      claudeEmail: true,
    },
  });

  if (!user?.claudeToken || !user?.claudeRefreshToken) {
    return { error: 'claude_account_not_linked', status: 403 };
  }

  // Check if token needs refresh (expired or within 5 minutes of expiry)
  const needsRefresh = user.claudeTokenExpiresAt
    ? user.claudeTokenExpiresAt.getTime() - Date.now() < 5 * 60 * 1000
    : false;

  if (needsRefresh) {
    try {
      const decryptedRefresh = decrypt(user.claudeRefreshToken);
      const newTokens = await refreshAccessToken(decryptedRefresh);
      const expiresAt = new Date(Date.now() + newTokens.expiresIn * 1000);

      await prisma.user.update({
        where: { email: userEmail },
        data: {
          claudeToken: encrypt(newTokens.accessToken),
          claudeRefreshToken: encrypt(newTokens.refreshToken),
          claudeTokenExpiresAt: expiresAt,
        },
      });

      return { token: newTokens.accessToken };
    } catch {
      // Refresh failed — clear tokens and ask user to re-link
      await prisma.user.update({
        where: { email: userEmail },
        data: {
          claudeToken: null,
          claudeRefreshToken: null,
          claudeTokenExpiresAt: null,
          claudeEmail: null,
        },
      });
      return { error: 'claude_token_expired', status: 403 };
    }
  }

  return { token: decrypt(user.claudeToken) };
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new Response('Unauthorized', { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  if (!user) {
    return new Response('User not found', { status: 404 });
  }

  // Get user's Claude token
  const tokenResult = await getUserClaudeToken(session.user.email);
  if ('error' in tokenResult) {
    return Response.json({ error: tokenResult.error }, { status: tokenResult.status });
  }

  const body = await request.json();
  const { conversationId, message } = body as {
    conversationId: string | null;
    message: string;
  };

  if (!message?.trim()) {
    return new Response('Message is required', { status: 400 });
  }

  // Get or create conversation
  let conversation;
  if (conversationId) {
    conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId: user.id },
    });
    if (!conversation) {
      return new Response('Conversation not found', { status: 404 });
    }
  } else {
    conversation = await prisma.conversation.create({
      data: {
        userId: user.id,
        title: message.slice(0, 100),
      },
    });
  }

  // Save user message
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: 'user',
      content: message,
    },
  });

  // Build system prompt with knowledge context
  const knowledgeEntries = await prisma.knowledgeEntry.findMany({
    orderBy: { createdAt: 'asc' },
  });

  let systemPrompt = config.systemPrompt;

  if (knowledgeEntries.length > 0) {
    const grouped: Record<string, string[]> = {};
    for (const entry of knowledgeEntries) {
      if (!grouped[entry.category]) grouped[entry.category] = [];
      grouped[entry.category].push(entry.content);
    }

    const categoryLabels: Record<string, string> = {
      correction: 'Important corrections (these override what you find in code)',
      terminology: 'Product terminology',
      product_insight: 'Product knowledge',
      process: 'Business processes',
    };

    let knowledgeBlock = '\n\n---\nKNOWLEDGE BASE (use this to give better answers):\n';
    for (const [cat, entries] of Object.entries(grouped)) {
      knowledgeBlock += `\n## ${categoryLabels[cat] || cat}\n`;
      for (const entry of entries) {
        knowledgeBlock += `- ${entry}\n`;
      }
    }
    systemPrompt += knowledgeBlock;
  }

  systemPrompt += `\n\n---
MEMORY SYSTEM — MANDATORY:
You have a "save_knowledge" tool. You MUST use it after EVERY answer where you investigated the codebase.

RULE: If you read any files or searched the codebase to answer a question, you MUST call save_knowledge at least once before finishing your response. This is not optional. The knowledge base is how the team builds shared understanding — every investigation adds value.

What to save (one call per distinct insight):
- How a feature works (e.g. "Badge printing supports 5 custom badge types per event, each tied to a registration category")
- Business rules you discovered (e.g. "HubSpot data takes priority over Summit data when both exist for the same contact")
- What product terms mean (e.g. "A 'coupling' in the platform means a connection to an external system like HubSpot or Summit")
- Corrections from the user (if they tell you something was wrong, save the correct version immediately)

Do NOT save:
- Things already listed in the KNOWLEDGE BASE section above
- Generic facts ("the platform manages events")

Keep entries concise (1-2 sentences). Always include 1-3 lowercase tags.`;

  // Spawn or resume Claude CLI with user's token
  const requestId = `${conversation.id}-${Date.now()}`;
  console.log(`[chat] Starting request (requestId=${requestId}, conversationId=${conversation.id}, resume=${!!conversation.claudeSessionId}, knowledgeEntries=${knowledgeEntries.length})`);

  const procOrPromise = conversation.claudeSessionId
    ? sessionManager.resumeSession(requestId, conversation.claudeSessionId, message, tokenResult.token)
    : sessionManager.startSession(requestId, message, systemPrompt, tokenResult.token);

  const proc = procOrPromise instanceof Promise ? await procOrPromise : procOrPromise;
  console.log(`[chat] Process acquired (pid=${proc.pid})`);

  // Stream response as SSE
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let fullResponse = '';
      let claudeSessionId: string | null = null;
      let closed = false;

      const safeSend = (data: string) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      const safeClose = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };

      proc.stdout!.on('data', (chunk: Buffer) => {
        const raw = chunk.toString();
        console.log(`[chat] stdout chunk (${raw.length} bytes):`, raw.slice(0, 200));

        const lines = raw.split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            console.log(`[chat] Parsed event: type=${event.type}, subtype=${event.subtype || 'none'}`);

            if (event.type === 'system' && event.session_id) {
              claudeSessionId = event.session_id;
              console.log(`[chat] Got session ID from system event: ${claudeSessionId}`);
            }

            if (event.type === 'stream_event' && event.event?.type === 'content_block_delta') {
              const delta = event.event.delta;
              if (delta?.type === 'text_delta' && delta.text) {
                fullResponse += delta.text;
                const sseData = JSON.stringify({ type: 'text', content: delta.text });
                safeSend(sseData);
              }
            }

            if (event.type === 'assistant' && event.message?.content) {
              for (const block of event.message.content) {
                if (block.type === 'tool_use') {
                  const toolName = block.name || 'unknown';
                  const sseData = JSON.stringify({ type: 'tool_use', tool: toolName });
                  safeSend(sseData);
                }
              }
            }

            if (event.type === 'result') {
              if (event.session_id) {
                claudeSessionId = event.session_id;
                console.log(`[chat] Got session ID from result event: ${claudeSessionId}`);
              }
              console.log(`[chat] Result event received, response length: ${fullResponse.length}`);
            }
          } catch {
            console.log(`[chat] Non-JSON line: ${line.slice(0, 100)}`);
          }
        }
      });

      proc.stderr!.on('data', (chunk: Buffer) => {
        console.error('[chat] stderr:', chunk.toString());
      });

      proc.on('close', async (code) => {
        console.log(`[chat] Process closed (code=${code}, responseLength=${fullResponse.length}, sessionId=${claudeSessionId})`);
        if (fullResponse) {
          await prisma.message.create({
            data: {
              conversationId: conversation.id,
              role: 'assistant',
              content: fullResponse,
            },
          });
        }

        if (claudeSessionId) {
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { claudeSessionId },
          });
        }

        const doneData = JSON.stringify({
          type: 'done',
          conversationId: conversation.id,
        });
        safeSend(doneData);
        safeClose();
      });

      proc.on('error', (err) => {
        console.error(`[chat] Process error:`, err.message);
        const errorData = JSON.stringify({
          type: 'error',
          content: 'Claude process encountered an error. Please try again.',
        });
        safeSend(errorData);
        safeClose();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat: chat route fetches user's Claude token with auto-refresh before spawning"
```

---

### Task 9: Settings Page

**Files:**
- Create: `src/app/settings/page.tsx`

- [ ] **Step 1: Create the settings page**

Create `src/app/settings/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { redirect, useSearchParams } from 'next/navigation';

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const [claudeStatus, setClaudeStatus] = useState<{ linked: boolean; email: string | null } | null>(null);
  const [unlinking, setUnlinking] = useState(false);

  const success = searchParams.get('success');
  const error = searchParams.get('error');

  useEffect(() => {
    fetch('/api/auth/claude/status')
      .then((res) => res.json())
      .then(setClaudeStatus)
      .catch(console.error);
  }, [success]);

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    redirect('/login');
  }

  const handleUnlink = async () => {
    setUnlinking(true);
    try {
      await fetch('/api/auth/claude/unlink', { method: 'POST' });
      setClaudeStatus({ linked: false, email: null });
    } catch (err) {
      console.error('Failed to unlink:', err);
    } finally {
      setUnlinking(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
        <h1 className="mb-6 text-xl font-bold text-gray-900">Settings</h1>

        {success === 'linked' && (
          <div className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">
            Claude account linked successfully!
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            Failed to link Claude account: {error.replace(/_/g, ' ')}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <h2 className="mb-1 text-sm font-medium text-gray-700">App Account</h2>
            <p className="text-sm text-gray-500">{session?.user?.email}</p>
          </div>

          <div className="border-t border-gray-200 pt-4">
            <h2 className="mb-3 text-sm font-medium text-gray-700">Claude Account</h2>

            {claudeStatus === null ? (
              <p className="text-sm text-gray-400">Loading...</p>
            ) : claudeStatus.linked ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                  <span className="text-sm text-gray-700">Connected</span>
                  {claudeStatus.email && (
                    <span className="text-sm text-gray-400">({claudeStatus.email})</span>
                  )}
                </div>
                <button
                  onClick={handleUnlink}
                  disabled={unlinking}
                  className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {unlinking ? 'Unlinking...' : 'Unlink Claude Account'}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-gray-300" />
                  <span className="text-sm text-gray-500">Not connected</span>
                </div>
                <p className="text-xs text-gray-400">
                  Link your Claude account to start asking questions. Requires a Claude Max, Pro, or Team subscription.
                </p>
                <a
                  href="/api/auth/claude"
                  className="inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Link Claude Account
                </a>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 border-t border-gray-200 pt-4">
          <a href="/" className="text-sm text-blue-600 hover:text-blue-700">
            &larr; Back to chat
          </a>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/settings/page.tsx
git commit -m "feat: add settings page with Claude account link/unlink UI"
```

---

### Task 10: Sidebar Settings Link

**Files:**
- Modify: `src/components/ChatSidebar.tsx:75-94`

- [ ] **Step 1: Add settings link to sidebar**

In `src/components/ChatSidebar.tsx`, add a Settings link in the navigation section. Replace the `<div className="border-t border-gray-200 p-3 space-y-2">` block (lines 75-94) with:

```tsx
      <div className="border-t border-gray-200 p-3 space-y-2">
        <a
          href="/settings"
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-200"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Settings
        </a>
        <a
          href="/dashboard"
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-200"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          Dashboard
        </a>
        <a
          href="/knowledge"
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-200"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          Knowledge Map
        </a>
      </div>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ChatSidebar.tsx
git commit -m "feat: add settings link to sidebar navigation"
```

---

### Task 11: Chat Page — Block When Account Not Linked

**Files:**
- Modify: `src/app/page.tsx:58-78, 163-182`

- [ ] **Step 1: Add Claude account status check and blocking state**

In `src/app/page.tsx`, add state for Claude link status and update the `handleSend` function to handle 403 errors. Also add a blocking overlay when not linked.

Replace the full content of `src/app/page.tsx`:

```tsx
'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import ChatSidebar from '@/components/ChatSidebar';
import ChatMessages from '@/components/ChatMessages';
import ChatInput from '@/components/ChatInput';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export default function Home() {
  const { data: session, status } = useSession();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [claudeLinked, setClaudeLinked] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/auth/claude/status')
      .then((res) => res.json())
      .then((data) => setClaudeLinked(data.linked))
      .catch(() => setClaudeLinked(false));
  }, []);

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    redirect('/login');
  }

  const loadConversation = async (id: string) => {
    const res = await fetch(`/api/conversations/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setConversationId(id);
    setMessages(
      data.messages.map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
      }))
    );
    setStreamingContent('');
  };

  const handleNewChat = () => {
    setConversationId(null);
    setMessages([]);
    setStreamingContent('');
  };

  const handleSend = async (message: string) => {
    const tempId = `temp-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: tempId, role: 'user', content: message },
    ]);
    setIsLoading(true);
    setStreamingContent('');
    setToolStatus(null);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, message }),
      });

      if (res.status === 403) {
        const data = await res.json();
        if (data.error === 'claude_account_not_linked' || data.error === 'claude_token_expired') {
          setClaudeLinked(false);
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          return;
        }
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6);

          try {
            const event = JSON.parse(jsonStr);

            if (event.type === 'text') {
              accumulated += event.content;
              setStreamingContent(accumulated);
              setToolStatus(null);
            }

            if (event.type === 'tool_use') {
              const labels: Record<string, string> = {
                Glob: 'Searching for files...',
                Grep: 'Searching code...',
                Read: 'Reading files...',
                Bash: 'Running a command...',
                WebSearch: 'Searching the web...',
                WebFetch: 'Fetching a page...',
                mcp__knowledge__save_knowledge: 'Saving to knowledge base...',
              };
              setToolStatus(labels[event.tool] || 'Analyzing the codebase...');
            }

            if (event.type === 'done') {
              setToolStatus(null);
              setConversationId(event.conversationId);
              setMessages((prev) => [
                ...prev,
                {
                  id: `assistant-${Date.now()}`,
                  role: 'assistant',
                  content: accumulated,
                },
              ]);
              setStreamingContent('');
              setRefreshTrigger((prev) => prev + 1);
            }

            if (event.type === 'error') {
              setStreamingContent('');
              setMessages((prev) => [
                ...prev,
                {
                  id: `error-${Date.now()}`,
                  role: 'assistant',
                  content: `Error: ${event.content}`,
                },
              ]);
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: 'Failed to connect. Please try again.',
        },
      ]);
      setStreamingContent('');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen">
      <ChatSidebar
        activeConversationId={conversationId}
        onSelectConversation={loadConversation}
        onNewChat={handleNewChat}
        refreshTrigger={refreshTrigger}
      />
      <div className="flex flex-1 flex-col">
        {claudeLinked === false ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
            <div className="text-center">
              <h2 className="mb-2 text-lg font-semibold text-gray-900">
                Link your Claude account
              </h2>
              <p className="mb-4 max-w-sm text-sm text-gray-500">
                To start asking questions, you need to link your Claude account.
                This requires a Claude Max, Pro, or Team subscription.
              </p>
              <a
                href="/api/auth/claude"
                className="inline-block rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white hover:bg-blue-700"
              >
                Link Claude Account
              </a>
            </div>
          </div>
        ) : (
          <>
            <ChatMessages
              messages={messages}
              streamingContent={streamingContent}
              toolStatus={toolStatus}
              isLoading={isLoading}
              onSendSuggestion={handleSend}
            />
            <ChatInput onSend={handleSend} disabled={isLoading} />
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: block chat access when Claude account is not linked"
```

---

### Task 12: Environment Variable & Final Verification

**Files:**
- Modify: `.env` (or `.env.example` if it exists)

- [ ] **Step 1: Add TOKEN_ENCRYPTION_KEY to env**

Generate a key:
```bash
openssl rand -hex 32
```

Add to `.env`:
```
TOKEN_ENCRYPTION_KEY=<output from above>
```

- [ ] **Step 2: Run the migration if not done**

```bash
npx prisma migrate dev --name add-claude-token-fields
```

- [ ] **Step 3: Run tests**

Run: `npx jest`
Expected: All tests pass

- [ ] **Step 4: Run dev server and verify**

Run: `npm run dev`

Verify:
1. Open `http://localhost:3000` — should show "Link your Claude account" blocking state
2. Click "Link Claude Account" — should redirect to `claude.ai/oauth/authorize`
3. Visit `/settings` — should show unlinked status with link button
4. Check sidebar — should have Settings link

- [ ] **Step 5: Commit**

```bash
git add .env.example  # or .env if that's what's tracked
git commit -m "feat: complete Claude account linking — env setup and final wiring"
```
