import { QueryClient, isServer } from '@tanstack/react-query';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // With SSR, an immediate refetch on the client for data the server
        // just sent is pure waste. A short staleTime also means navigating
        // back to a page you just left renders from cache with no loading
        // state at all — which is the whole point of adopting this.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // A 401/403/404 will not become a 200 by asking again; only retry
          // what might genuinely be transient.
          const status = (error as { status?: number } | null)?.status;
          if (status && status >= 400 && status < 500) return false;
          return failureCount < 2;
        },
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/**
 * One client per browser tab, a fresh one per server request.
 *
 * Reusing a single module-level client on the server would leak one user's
 * cached data into another user's request, so the server branch must always
 * construct a new one.
 */
export function getQueryClient() {
  if (isServer) return makeQueryClient();
  // Not created at module scope: React may suspend during the initial render,
  // and a client created before that point can be discarded.
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}
