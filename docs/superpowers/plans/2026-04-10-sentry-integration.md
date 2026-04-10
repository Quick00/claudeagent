# Sentry Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Sentry error tracking to both client and server using `@sentry/nextjs`.

**Architecture:** The `@sentry/nextjs` SDK initializes via two config files (`sentry.server.config.ts`, `sentry.client.config.ts`) which are imported by Next.js instrumentation hooks (`instrumentation.ts`, `instrumentation-client.ts`). A `global-error.tsx` catches uncaught React rendering errors. `next.config.ts` is wrapped with `withSentryConfig` for source map upload.

**Tech Stack:** `@sentry/nextjs`, Next.js 16 App Router instrumentation hooks

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `sentry.server.config.ts` | Create | Server-side Sentry SDK init |
| `sentry.client.config.ts` | Create | Client-side Sentry SDK init |
| `src/instrumentation.ts` | Create | Next.js server instrumentation — imports server config, wires `onRequestError` |
| `src/instrumentation-client.ts` | Create | Next.js client instrumentation — imports client config |
| `src/app/global-error.tsx` | Create | Root error boundary for uncaught React errors |
| `next.config.ts` | Modify | Wrap with `withSentryConfig` |
| `.env.example` | Modify | Add `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_AUTH_TOKEN` |
| `package.json` | Modify | Add `@sentry/nextjs` dependency |

---

### Task 1: Install `@sentry/nextjs`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

Run:
```bash
npm install @sentry/nextjs
```

- [ ] **Step 2: Verify installation**

Run:
```bash
node -e "require('@sentry/nextjs'); console.log('ok')"
```
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install @sentry/nextjs"
```

---

### Task 2: Create Sentry config files

**Files:**
- Create: `sentry.server.config.ts`
- Create: `sentry.client.config.ts`

- [ ] **Step 1: Create server config**

Create `sentry.server.config.ts` in the project root:

```ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,

  // Error tracking only — no performance monitoring
  tracesSampleRate: 0,
});
```

- [ ] **Step 2: Create client config**

Create `sentry.client.config.ts` in the project root:

```ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,

  // Error tracking only — no performance monitoring
  tracesSampleRate: 0,
});
```

- [ ] **Step 3: Commit**

```bash
git add sentry.server.config.ts sentry.client.config.ts
git commit -m "feat: add Sentry server and client config files"
```

---

### Task 3: Create instrumentation hooks

**Files:**
- Create: `src/instrumentation.ts`
- Create: `src/instrumentation-client.ts`

**Docs to check:** `node_modules/next/dist/docs/01-app/02-guides/instrumentation.md` and `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation-client.md`

- [ ] **Step 1: Create server instrumentation**

Create `src/instrumentation.ts`:

```ts
import * as Sentry from "@sentry/nextjs";
import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
}

export const onRequestError: Instrumentation.onRequestError = (...args) => {
  return Sentry.captureRequestError(...args);
};
```

This uses the Next.js `register()` hook to init Sentry on server startup, and `onRequestError` to automatically report server errors (API routes, RSC, Server Actions) with request context.

- [ ] **Step 2: Create client instrumentation**

Create `src/instrumentation-client.ts`:

```ts
import "../sentry.client.config";
```

This file runs before React hydration. The import initializes the Sentry browser SDK as a side effect.

- [ ] **Step 3: Commit**

```bash
git add src/instrumentation.ts src/instrumentation-client.ts
git commit -m "feat: add Next.js instrumentation hooks for Sentry"
```

---

### Task 4: Create global error boundary

**Files:**
- Create: `src/app/global-error.tsx`

**Docs to check:** `node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md` — see "Global errors" section. The component must define its own `<html>` and `<body>` tags.

- [ ] **Step 1: Create global-error.tsx**

Create `src/app/global-error.tsx`:

```tsx
"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <h2>Something went wrong!</h2>
        <button onClick={() => unstable_retry()}>Try again</button>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/global-error.tsx
git commit -m "feat: add global error boundary with Sentry reporting"
```

---

### Task 5: Wrap next.config.ts with Sentry

**Files:**
- Modify: `next.config.ts:1-7`

- [ ] **Step 1: Update next.config.ts**

Replace the entire content of `next.config.ts` with:

```ts
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default withSentryConfig(nextConfig, {
  silent: true,
  disableLogger: true,
});
```

`silent: true` suppresses source map upload logs. `disableLogger: true` disables the Sentry logger to reduce noise.

- [ ] **Step 2: Commit**

```bash
git add next.config.ts
git commit -m "feat: wrap next.config.ts with withSentryConfig"
```

---

### Task 6: Add environment variables to .env.example

**Files:**
- Modify: `.env.example:28-29` (append after last line)

- [ ] **Step 1: Append Sentry vars to .env.example**

Add the following to the end of `.env.example`:

```
# Sentry
SENTRY_DSN=
SENTRY_ENVIRONMENT=
SENTRY_AUTH_TOKEN=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore: add Sentry env vars to .env.example"
```

---

### Task 7: Verify the build

- [ ] **Step 1: Run the build**

Run:
```bash
npm run build
```

Expected: Build succeeds. Sentry will log a warning about missing `SENTRY_DSN` which is expected in dev without env vars set.

- [ ] **Step 2: Run existing tests**

Run:
```bash
npm test
```

Expected: All existing tests pass. No tests broken by the integration.

- [ ] **Step 3: Run lint**

Run:
```bash
npm run lint
```

Expected: No new lint errors.

- [ ] **Step 4: Commit any fixes if needed**

If build/test/lint revealed issues, fix them and commit:
```bash
git add -A
git commit -m "fix: resolve Sentry integration issues"
```
