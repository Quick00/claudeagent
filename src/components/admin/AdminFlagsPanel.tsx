'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Flag } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageContainer } from '@/components/shared/PageContainer';
import { PageHeader } from '@/components/shared/PageHeader';
import { RiseIn } from '@/components/shared/RiseIn';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useDeferredSkeleton } from '@/hooks/use-deferred-skeleton';
import { apiFetch, jsonBody } from '@/lib/api';
import { ROUTES } from '@/lib/navigation';
import { qk } from '@/lib/query-keys';
import { formatDateTimeShort } from '@/lib/format-date';

interface FlagRow {
  id: string;
  reason: string | null;
  status: string;
  adminResponse: string | null;
  respondedAt: string | null;
  createdAt: string;
  user: { name: string; email: string };
  conversation: { id: string; title: string };
  admin: { id: string; name: string } | null;
}

type Filter = 'PENDING' | 'RESPONDED' | 'ALL';

export default function AdminFlagsPanel() {
  const queryClient = useQueryClient();
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [responseText, setResponseText] = useState('');
  const [filter, setFilter] = useState<Filter>('PENDING');

  const {
    data: flags = [],
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: qk.flags.adminList(),
    queryFn: () => apiFetch<FlagRow[]>('/api/flags'),
  });

  const respondMutation = useMutation({
    mutationFn: ({ flagId, adminResponse }: { flagId: string; adminResponse: string }) =>
      apiFetch(`/api/flags/${flagId}`, jsonBody('PATCH', { adminResponse })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.flags.adminList() });
      setRespondingTo(null);
      setResponseText('');
      toast.success('Response sent');
    },
    onError: () => toast.error('Failed to send response'),
  });

  const handleRespond = (flagId: string) => {
    if (!responseText.trim() || respondMutation.isPending) return;
    respondMutation.mutate({ flagId, adminResponse: responseText });
  };

  const filtered = flags.filter((f) => filter === 'ALL' || f.status === filter);
  const showSkeleton = useDeferredSkeleton(isPending);

  return (
    <PageContainer>
      <RiseIn delay={0}>
        <PageHeader title="Flags" description="Conversations users have flagged for review." />
      </RiseIn>

      <RiseIn delay={0.06}>
      <div className="flex justify-end">
        <ToggleGroup type="single" variant="outline" value={filter} onValueChange={(v) => v && setFilter(v as Filter)}>
          <ToggleGroupItem value="PENDING">
            Pending <span className="ml-1.5 text-muted-foreground">{flags.filter((f) => f.status === 'PENDING').length}</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="RESPONDED">
            Responded <span className="ml-1.5 text-muted-foreground">{flags.filter((f) => f.status === 'RESPONDED').length}</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="ALL">
            All <span className="ml-1.5 text-muted-foreground">{flags.length}</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      </RiseIn>

      <RiseIn delay={0.12}>
      {isPending ? (
        showSkeleton && (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        )
      ) : (
      /* Nested RiseIn: this subtree mounts fresh the moment loading flips
         to false, so the loaded content arrives with the same rise/fade
         the rest of the page uses instead of popping in place. */
      <RiseIn delay={0}>
      {isError ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : flags.length === 0 ? (
        <EmptyState icon={Flag} title="No flagged conversations yet" />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Flag} title={`No ${filter.toLowerCase()} flags`} />
      ) : (
        <div className="space-y-4">
          {filtered.map((flag) => {
            const open = respondingTo === flag.id;
            return (
              <div key={flag.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <StatusBadge kind="flag" value={flag.status} />
                      <Link href={ROUTES.chat(flag.conversation.id)} className="text-sm font-medium text-primary hover:underline">
                        {flag.conversation.title}
                      </Link>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Flagged by <span className="font-medium">{flag.user.name}</span> ({flag.user.email})
                      {' — '}
                      {formatDateTimeShort(flag.createdAt)}
                    </div>
                    {flag.reason && (
                      <p className="mt-2 text-sm text-foreground">
                        <span className="font-medium">Reason:</span> {flag.reason}
                      </p>
                    )}
                    {flag.adminResponse && (
                      <div className="mt-3 rounded-md border border-border bg-background p-3">
                        <div className="text-xs font-medium text-success">
                          Response by {flag.admin?.name || 'Admin'}
                          {flag.respondedAt && (
                            <span className="ml-2 font-normal text-muted-foreground">
                              {formatDateTimeShort(flag.respondedAt)}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-foreground">{flag.adminResponse}</p>
                      </div>
                    )}
                  </div>
                  {flag.status === 'PENDING' && (
                    <Button
                      size="sm"
                      onClick={() => { setRespondingTo(open ? null : flag.id); setResponseText(''); }}
                    >
                      Respond
                    </Button>
                  )}
                </div>
                <Collapsible open={open}>
                  <CollapsibleContent className="mt-3 border-t border-border pt-3">
                    <Textarea
                      value={responseText}
                      onChange={(e) => setResponseText(e.target.value)}
                      placeholder="Write your response to the user..."
                      rows={3}
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setRespondingTo(null); setResponseText(''); }}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleRespond(flag.id)}
                        disabled={!responseText.trim() || respondMutation.isPending}
                      >
                        {respondMutation.isPending ? 'Sending...' : 'Send Response'}
                      </Button>
                    </div>
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
