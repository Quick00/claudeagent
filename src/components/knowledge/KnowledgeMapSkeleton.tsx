import { Skeleton } from '@/components/ui/skeleton';

/**
 * Mirrors the KnowledgeGraph layout: a count pill top-left, a category
 * legend bottom-left, and a canvas-sized fill behind them. Used both as the
 * `next/dynamic` loading fallback and as the zero-size-measurement guard.
 */
export function KnowledgeMapSkeleton() {
  return (
    <div className="relative h-full min-h-0 bg-background" aria-hidden>
      <div className="absolute left-4 top-4 z-10">
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>
      <div className="absolute bottom-4 left-4 z-10 flex gap-2">
        <Skeleton className="h-8 w-24 rounded-lg" />
        <Skeleton className="h-8 w-28 rounded-lg" />
        <Skeleton className="h-8 w-20 rounded-lg" />
      </div>
      <Skeleton className="size-full rounded-none" />
    </div>
  );
}
