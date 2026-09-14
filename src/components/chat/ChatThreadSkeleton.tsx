import { Skeleton } from '@/components/ui/skeleton';

/**
 * Mirrors `ChatThread`'s layout: header bar, a few bubbles, composer. Used by
 * the route's `loading.tsx` and by `ChatThread`'s own first fetch, so the
 * skeleton the router shows and the one the component shows are the same one.
 */
export function ChatThreadSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy>
      <div className="flex items-center justify-end gap-2 border-b border-border px-4 py-2">
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-20" />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-6">
        <div className="mx-auto max-w-3xl space-y-4">
          <div className="flex justify-end">
            <Skeleton className="h-12 w-2/5 rounded-2xl" />
          </div>
          <Skeleton className="h-28 w-full rounded-2xl" />
          <div className="flex justify-end">
            <Skeleton className="h-10 w-1/3 rounded-2xl" />
          </div>
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
      </div>

      <div className="border-t border-border p-4">
        <div className="mx-auto flex max-w-3xl items-end gap-3">
          <Skeleton className="size-9 shrink-0 rounded-md" />
          <Skeleton className="h-11 flex-1 rounded-xl" />
          <Skeleton className="h-10 w-20 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
