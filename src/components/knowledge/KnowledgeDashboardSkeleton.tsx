import { PageContainer } from '@/components/shared/PageContainer';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Mirrors KnowledgeDashboard's final layout — container included: stats,
 * category strip, topics/conversations, timeline. Used both by the route's
 * `loading.tsx` and by the dashboard's own first fetch, so it must carry its
 * own `PageContainer` rather than relying on a caller to add one.
 */
export function KnowledgeDashboardSkeleton() {
  return (
    <PageContainer className="space-y-8">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" aria-hidden>
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} size="sm">
            <CardContent>
              <Skeleton className="h-4 w-20" />
              <Skeleton className="mt-2 h-8 w-12" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-hidden>
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} size="sm">
            <CardContent>
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-2 h-7 w-8" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3" aria-hidden>
        <div className="lg:col-span-1 space-y-8">
          <Card size="sm">
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-7 w-16 rounded-full" />
                ))}
              </div>
            </CardContent>
          </Card>
          <Card size="sm" className="py-0">
            <CardContent className="space-y-0 px-0 py-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="px-4 py-3">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="mt-2 h-3 w-20" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-3">
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      </div>
    </PageContainer>
  );
}
