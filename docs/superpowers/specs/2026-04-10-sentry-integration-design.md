# Sentry Integration Design

**Date:** 2026-04-10
**Status:** Approved

## Goal

Add Sentry error tracking to both client and server using the official `@sentry/nextjs` SDK. No performance monitoring, session replay, or modifications to existing error handling code.

## Package

- `@sentry/nextjs` (supports Next.js 16)

## Files Created

### `sentry.server.config.ts`
Server-side Sentry configuration. Imported by `instrumentation.ts` during `register()`.

```ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  tracesSampleRate: 0, // error tracking only, no performance
});
```

### `sentry.client.config.ts`
Client-side Sentry configuration. Imported by `instrumentation-client.ts`.

```ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  tracesSampleRate: 0, // error tracking only, no performance
});
```

### `src/instrumentation.ts`
Next.js server instrumentation hook. Initializes Sentry server SDK and reports server errors.

```ts
import * as Sentry from "@sentry/nextjs";
import { type Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
}

export const onRequestError: Instrumentation.onRequestError = (...args) => {
  return Sentry.captureRequestError(...args);
};
```

### `src/instrumentation-client.ts`
Next.js client instrumentation hook. Runs before React hydration.

```ts
import * as Sentry from "@sentry/nextjs";
import "../sentry.client.config";

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
```

The `onRouterTransitionStart` export gives Sentry navigation breadcrumbs for richer error context.

### `src/app/global-error.tsx`
Root error boundary. Catches uncaught React rendering errors and reports to Sentry.

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

## Files Modified

### `next.config.ts`
Wrap existing config with `withSentryConfig` from `@sentry/nextjs`.

```ts
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig = {
  output: "standalone",
};

export default withSentryConfig(nextConfig, {
  silent: true, // suppress source map upload logs
});
```

### `.env.example`
Add Sentry environment variables:

```
# Sentry
SENTRY_DSN=
SENTRY_ENVIRONMENT=
SENTRY_AUTH_TOKEN=
```

## Error Capture Summary

| Error Type | Captured By | Notes |
|---|---|---|
| Server errors (API routes, RSC, Server Actions) | `onRequestError` in `instrumentation.ts` | Automatic, includes request context |
| Unhandled server exceptions | Sentry Node SDK | Automatic |
| React rendering errors (client) | `global-error.tsx` | Root error boundary |
| Unhandled browser errors | Sentry Browser SDK | `window.onerror`, `unhandledrejection` |
| Existing `console.error` calls | Not captured | Left as-is per requirements |

## What's Excluded

- Performance monitoring (`tracesSampleRate: 0`)
- Session replay
- Sentry tunnel route
- Modifications to existing error handling code
- Test page for verification

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SENTRY_DSN` | Yes | Sentry project DSN |
| `SENTRY_ENVIRONMENT` | No | Defaults to `NODE_ENV` |
| `SENTRY_AUTH_TOKEN` | No | For source map upload at build time; skipped if missing |

## Verification

After deploying, verify by triggering an error (e.g., `Sentry.captureException(new Error("test"))` in browser console or a route handler) and confirming it appears in the Sentry dashboard.
