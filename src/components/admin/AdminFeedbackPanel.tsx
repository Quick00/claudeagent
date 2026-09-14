'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bug, Lightbulb } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/shared/EmptyState';
import { MarkdownContent } from '@/components/shared/MarkdownContent';
import { PageContainer } from '@/components/shared/PageContainer';
import { PageHeader } from '@/components/shared/PageHeader';
import { RiseIn } from '@/components/shared/RiseIn';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useDeferredSkeleton } from '@/hooks/use-deferred-skeleton';
import { apiFetch, jsonBody } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { formatDateTimeShort } from '@/lib/format-date';

interface FeedbackRow {
  id: string;
  type: string;
  title: string;
  description: string;
  status: string;
  createdAt: string;
  user: { name: string; email: string };
  image: { id: string; filename: string } | null;
}

type Filter = 'TODO' | 'DONE' | 'ALL';

export default function AdminFeedbackPanel() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('TODO');

  const {
    data: posts = [],
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: qk.feedback.adminList(),
    queryFn: () => apiFetch<FeedbackRow[]>('/api/admin/feedback'),
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'TODO' | 'DONE' }) =>
      apiFetch(`/api/admin/feedback/${id}`, jsonBody('PATCH', { status })),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: qk.feedback.adminList() });
      toast.success(variables.status === 'DONE' ? 'Marked as done' : 'Reopened');
    },
    onError: () => toast.error('Failed to update feedback'),
  });

  const updateStatus = (id: string, status: 'TODO' | 'DONE') =>
    updateStatusMutation.mutate({ id, status });

  const updatingId = updateStatusMutation.isPending ? updateStatusMutation.variables?.id ?? null : null;

  const filtered = posts.filter((p) => filter === 'ALL' || p.status === filter);
  const showSkeleton = useDeferredSkeleton(isPending);

  return (
    <PageContainer>
      <RiseIn delay={0}>
        <PageHeader title="Feedback" description="Feature requests and bug reports from users." />
      </RiseIn>

      <RiseIn delay={0.06}>
      <div className="flex justify-end">
        <ToggleGroup type="single" variant="outline" value={filter} onValueChange={(v) => v && setFilter(v as Filter)}>
          <ToggleGroupItem value="TODO">
            To Do <span className="ml-1.5 text-muted-foreground">{posts.filter((p) => p.status === 'TODO').length}</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="DONE">
            Done <span className="ml-1.5 text-muted-foreground">{posts.filter((p) => p.status === 'DONE').length}</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="ALL">
            All <span className="ml-1.5 text-muted-foreground">{posts.length}</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      </RiseIn>

      <RiseIn delay={0.12}>
      {isPending ? (
        showSkeleton && (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        )
      ) : (
      /* Nested RiseIn: mounts fresh the moment loading flips to false, so
         the loaded content arrives with the same rise/fade the rest of
         the page uses instead of popping in place. */
      <RiseIn delay={0}>
      {isError ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : posts.length === 0 ? (
        <EmptyState icon={Lightbulb} title="No feedback submissions yet" />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Lightbulb} title={`No ${filter === 'TODO' ? 'to-do' : filter === 'DONE' ? 'done' : ''} feedback`} />
      ) : (
        <div className="space-y-4">
          {filtered.map((post) => {
            const open = expandedId === post.id;
            const Icon = post.type === 'FEATURE_REQUEST' ? Lightbulb : Bug;
            return (
              <div key={post.id} className="rounded-lg border border-border bg-card p-4">
                <Collapsible open={open} onOpenChange={(next) => setExpandedId(next ? post.id : null)}>
                  <div className="flex items-start justify-between gap-4">
                    <CollapsibleTrigger asChild>
                      <Button
                        variant="ghost"
                        className="h-auto flex-1 justify-start whitespace-normal p-0 text-left hover:bg-transparent"
                      >
                        <div>
                          <div className="flex items-center gap-3">
                            <Icon className="size-4 text-muted-foreground" />
                            <StatusBadge kind="feedback" value={post.status} />
                            <span className="text-sm font-medium">{post.title}</span>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            by <span className="font-medium">{post.user.name}</span> ({post.user.email})
                            {' — '}
                            {formatDateTimeShort(post.createdAt)}
                          </div>
                        </div>
                      </Button>
                    </CollapsibleTrigger>
                    <Button
                      size="sm"
                      variant={post.status === 'TODO' ? 'default' : 'secondary'}
                      disabled={updatingId === post.id}
                      onClick={() => updateStatus(post.id, post.status === 'TODO' ? 'DONE' : 'TODO')}
                    >
                      {updatingId === post.id ? 'Updating...' : post.status === 'TODO' ? 'Mark as Done' : 'Reopen'}
                    </Button>
                  </div>
                  <CollapsibleContent className="mt-3 border-t border-border pt-3">
                    <MarkdownContent content={post.description} density="compact" />
                    {post.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/upload/${post.image.id}`}
                        alt={post.image.filename}
                        className="mt-2 max-h-64 rounded-md border border-border"
                      />
                    )}
                  </CollapsibleContent>
                </Collapsible>
              </div>
            );
          })}
        </div>
      )}
      </RiseIn>
      )}
      </RiseIn>
    </PageContainer>
  );
}
