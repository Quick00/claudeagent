'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Flag } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ROUTES } from '@/lib/navigation';
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
  const { data: session } = useSession();
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [responseText, setResponseText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter] = useState<Filter>('PENDING');

  useEffect(() => {
    fetch('/api/flags')
      .then((res) => {
        if (res.status === 403) { setError('Forbidden'); return []; }
        if (!res.ok) throw new Error('Failed to fetch flags');
        return res.json();
      })
      .then(setFlags)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleRespond = async (flagId: string) => {
    if (!responseText.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/flags/${flagId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminResponse: responseText }),
      });
      if (!res.ok) { toast.error('Failed to send response'); return; }
      const updated = await res.json();
      setFlags((prev) =>
        prev.map((f) =>
          f.id === flagId
            ? {
                ...f,
                status: updated.status,
                adminResponse: updated.adminResponse,
                respondedAt: updated.respondedAt,
                admin: { id: (session?.user as Record<string, string>)?.id, name: session?.user?.name || 'Admin' },
              }
            : f
        )
      );
      setRespondingTo(null);
      setResponseText('');
      toast.success('Response sent');
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = flags.filter((f) => filter === 'ALL' || f.status === filter);

  return (
    <div className="space-y-6">
      <PageHeader title="Flags" description="Conversations users have flagged for review." />

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

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
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
                        disabled={!responseText.trim() || submitting}
                      >
                        {submitting ? 'Sending...' : 'Send Response'}
                      </Button>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
