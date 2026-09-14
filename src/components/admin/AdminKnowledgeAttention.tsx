'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AdminTableSkeleton } from '@/components/admin/AdminTableSkeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageContainer } from '@/components/shared/PageContainer';
import { PageHeader } from '@/components/shared/PageHeader';
import { RiseIn } from '@/components/shared/RiseIn';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useConfirm } from '@/hooks/use-confirm';
import { useDeferredSkeleton } from '@/hooks/use-deferred-skeleton';
import { ApiError, apiFetch, jsonBody } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { formatDateTime } from '@/lib/format-date';

interface Item {
  id: string; subject: string; category: string; content: string; tags: string; kind: string;
  hitCount: number; lastRetrievedAt: string | null; correctionCount: number; updatedAt: string;
  sourceCount: number; lastVerifiedAt: string | null; changedPaths: string[];
}
interface Review { id: string; type: string; payload: Record<string, unknown>; createdAt: string; entry: { id: string; subject: string; kind: string; content: string } }
interface Sync { id: string; repositoryName: string | null; gitlabProjectId: number; fromSha: string; toSha: string; changedFileCount: number; reason: string; wouldStaleCount: number; syncedAt: string }
interface Attention { stale: Item[]; unverified: Item[]; pinned: Item[]; reviews: Review[]; syncs: Sync[] }

type Tab = 'stale' | 'unverified' | 'pinned' | 'reviews' | 'syncs';
const CATEGORIES = ['terminology', 'product_insight', 'process', 'developer'];

export default function AdminKnowledgeAttention() {
  const confirmDialog = useConfirm();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('stale');
  // A key per in-flight action (an entry id or a review id), not one global
  // flag: a slow tier-2 verify on one entry must not disable every other
  // row's buttons or the other tabs while it runs.
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Item | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ subject: '', content: '', category: 'process', tags: '' });

  const {
    data,
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: qk.knowledge.attention(),
    queryFn: () => apiFetch<Attention>('/api/admin/knowledge'),
  });

  const invalidateAttention = () => queryClient.invalidateQueries({ queryKey: qk.knowledge.attention() });

  const actMutation = useMutation({
    mutationFn: (vars: {
      key: string;
      run: () => Promise<Record<string, unknown>>;
      okMessage?: (body: Record<string, unknown>) => string;
    }) => vars.run(),
    onMutate: (vars) => {
      setBusyKeys((prev) => new Set(prev).add(vars.key));
    },
    onSuccess: (body, vars) => {
      toast.success(vars.okMessage ? vars.okMessage(body) : 'Done');
      invalidateAttention();
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        // The request completed with an error response (e.g. a 409 because a
        // tier 2 run is already in flight) — the server may still have
        // recorded something, so refresh rather than leaving the tab stale.
        toast.error(`Error: ${(err.body as { error?: string } | null)?.error ?? err.status}`);
        invalidateAttention();
        return;
      }
      // A full verification holds the connection for as long as the verifier
      // runs, so a proxy timeout or a dropped connection lands here. Without
      // this the button just re-enabled with no message and the admin had
      // every reason to start a second (paid) run. The server-side outcome
      // here is genuinely unknown, so this does not invalidate.
      toast.error(
        `The request did not complete: ${err instanceof Error ? err.message : String(err)}. ` +
          'A full verification may still be running — reload this page in a few minutes before starting another one.',
      );
    },
    onSettled: (_data, _err, vars) => {
      setBusyKeys((prev) => {
        const next = new Set(prev);
        next.delete(vars.key);
        return next;
      });
    },
  });

  // `mutateAsync` (not `mutate`) so the `EntryForm` dialog below can `await`
  // this and keep its own "Saving…" state up for the full round trip. The
  // `onError` above already reports failures via toast, so the rejection
  // here is swallowed rather than left unhandled for fire-and-forget callers
  // (the row action buttons, which don't await this at all).
  const act = (
    key: string,
    run: () => Promise<Record<string, unknown>>,
    okMessage?: (body: Record<string, unknown>) => string,
  ) => actMutation.mutateAsync({ key, run, okMessage }).catch(() => undefined);

  const patch = (id: string, body: Record<string, string>) =>
    apiFetch<Record<string, unknown>>(`/api/admin/knowledge/${id}`, jsonBody('PATCH', body));
  const verify = (id: string, tier: 1 | 2) =>
    apiFetch<Record<string, unknown>>(`/api/admin/knowledge/${id}/verify`, jsonBody('POST', { tier }));
  const review = (id: string, action: 'accept' | 'dismiss') =>
    apiFetch<Record<string, unknown>>(`/api/admin/knowledge/reviews/${id}`, jsonBody('PATCH', { action }));

  const retireEntry = async (item: Item) => {
    const ok = await confirmDialog({ title: `Retire "${item.subject}"?`, confirmLabel: 'Retire' });
    if (!ok) return;
    act(item.id, () => patch(item.id, { status: 'retired' }), () => 'Retired');
  };

  const showSkeleton = useDeferredSkeleton(isPending);

  if (isPending) {
    return showSkeleton ? <AdminTableSkeleton columns={5} /> : null;
  }

  if (isError || !data) {
    return (
      <PageContainer>
        <RiseIn delay={0}>
          <PageHeader title="Knowledge" description="Stale, unverified, and pinned knowledge entries." />
        </RiseIn>
        <RiseIn delay={0.06}>
          <p className="text-sm text-destructive">{error?.message ?? 'Failed to load knowledge entries'}</p>
        </RiseIn>
      </PageContainer>
    );
  }

  const counts: Record<Tab, number> = {
    stale: data.stale.length,
    unverified: data.unverified.length,
    pinned: data.pinned.length,
    reviews: data.reviews.length,
    syncs: data.syncs.length,
  };

  function renderItems(items: Item[], variant: 'stale' | 'unverified' | 'pinned') {
    const stale = variant === 'stale';
    const pinned = variant === 'pinned';
    if (items.length === 0) {
      return <EmptyState title={pinned ? 'No pinned rules yet' : 'Nothing here'} />;
    }
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Subject</TableHead>
            <TableHead>{stale ? 'Changed files' : 'Sources'}</TableHead>
            <TableHead>Hits</TableHead>
            <TableHead>Last verified</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((it) => (
            <TableRow key={it.id}>
              <TableCell className="align-top">
                <div className="font-medium">{it.subject || <span className="text-muted-foreground italic">(no subject)</span>}</div>
                <div className="mt-1 max-w-xl text-xs text-muted-foreground">{it.content}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {it.category} · {it.tags}{it.correctionCount > 0 && ` · corrected ${it.correctionCount}×`}
                </div>
              </TableCell>
              <TableCell className="align-top font-mono text-xs text-muted-foreground">
                {stale ? it.changedPaths.map((p) => <div key={p}>{p}</div>) : `${it.sourceCount} files`}
              </TableCell>
              <TableCell className="align-top">{it.hitCount}</TableCell>
              <TableCell className="align-top text-xs">{it.lastVerifiedAt ? formatDateTime(it.lastVerifiedAt) : '—'}</TableCell>
              <TableCell className="align-top">
                <div className="flex flex-wrap gap-3 text-xs">
                  {stale && (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0"
                      disabled={busyKeys.has(it.id)}
                      onClick={() => act(it.id, () => verify(it.id, 1), (b) => `Quick check: ${b.outcome} — ${b.reason}`)}
                    >
                      {busyKeys.has(it.id) ? 'Working…' : 'Quick check'}
                    </Button>
                  )}
                  {/* A pinned entry is human-owned and always fresh: there is nothing to verify. */}
                  {!pinned && (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0"
                      disabled={busyKeys.has(it.id)}
                      onClick={() => act(
                        it.id,
                        () => verify(it.id, 2),
                        (b) => `Full verification: ${b.outcome} — ${b.reason}${b.costUsd ? ` ($${Number(b.costUsd).toFixed(2)})` : ''}`,
                      )}
                    >
                      Full verification
                    </Button>
                  )}
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-muted-foreground"
                    disabled={busyKeys.has(it.id)}
                    onClick={() => setEditing(it)}
                  >
                    Edit
                  </Button>
                  {pinned ? (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-warning"
                      disabled={busyKeys.has(it.id)}
                      onClick={() => act(it.id, () => patch(it.id, { kind: 'derived' }), () => 'Unpinned — its provenance is back in use')}
                    >
                      Unpin
                    </Button>
                  ) : (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-warning"
                      disabled={busyKeys.has(it.id)}
                      onClick={() => act(it.id, () => patch(it.id, { kind: 'pinned' }), () => 'Pinned — find it in the Pinned tab')}
                    >
                      Pin
                    </Button>
                  )}
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-destructive"
                    disabled={busyKeys.has(it.id)}
                    onClick={() => retireEntry(it)}
                  >
                    Retire
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  function describeReview(r: Review): string {
    if (r.type === 'pinned_conflict') return `Claude found code contradicting the pinned rule. Proposed: "${String(r.payload.proposedContent ?? '')}" (${String(r.payload.reason ?? '')})`;
    if (r.type === 'supersedes') return `A fresh page "${String(r.payload.newSubject ?? '')}" was created next to this stale page. Accept retires the stale page.`;
    if (r.type === 'proposed_update') return `Quick check suggests: "${String(r.payload.suggestedContent ?? '')}" (${String(r.payload.reason ?? '')})`;
    return r.type;
  }

  return (
    <PageContainer>
      <RiseIn delay={0}>
        <PageHeader
          title="Knowledge"
          description="Stale, unverified, and pinned knowledge entries."
          actions={<Button onClick={() => setCreating(true)}>New pinned rule</Button>}
        />
      </RiseIn>

      <RiseIn delay={0.06}>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          {(['stale', 'unverified', 'pinned', 'reviews', 'syncs'] as Tab[]).map((t) => (
            <TabsTrigger key={t} value={t}>
              {t[0].toUpperCase() + t.slice(1)} ({counts[t]})
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="stale">{renderItems(data.stale, 'stale')}</TabsContent>
        <TabsContent value="unverified">{renderItems(data.unverified, 'unverified')}</TabsContent>
        <TabsContent value="pinned">{renderItems(data.pinned, 'pinned')}</TabsContent>
        <TabsContent value="reviews">
          {data.reviews.length === 0 ? (
            <EmptyState title="No open reviews" />
          ) : (
            <ul className="divide-y divide-border">
              {data.reviews.map((r) => (
                <li key={r.id} className="py-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    {r.entry.subject}
                    <StatusBadge kind="reviewType" value={r.type} />
                    {/* Without this the admin cannot see that accepting would rewrite a human-owned rule. */}
                    {r.entry.kind === 'pinned' && <StatusBadge kind="knowledgeKind" value="pinned" />}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">Current: {r.entry.content}</div>
                  <div className="mt-1 text-foreground">{describeReview(r)}</div>
                  <div className="mt-2 flex gap-4 text-xs">
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-success"
                      disabled={busyKeys.has(r.id)}
                      onClick={() => act(r.id, () => review(r.id, 'accept'), () => 'Accepted')}
                    >
                      Accept
                    </Button>
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-muted-foreground"
                      disabled={busyKeys.has(r.id)}
                      onClick={() => act(r.id, () => review(r.id, 'dismiss'), () => 'Dismissed')}
                    >
                      Dismiss
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="syncs">
          {data.syncs.length === 0 ? (
            <EmptyState title="No repository syncs recorded yet" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Repository</TableHead>
                  <TableHead>Commits</TableHead>
                  <TableHead>Files changed</TableHead>
                  <TableHead>Entries affected</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.syncs.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-xs">{formatDateTime(s.syncedAt)}</TableCell>
                    <TableCell>{s.repositoryName ?? `project ${s.gitlabProjectId}`}</TableCell>
                    <TableCell className="font-mono text-xs">{s.fromSha.slice(0, 7)} → {s.toSha.slice(0, 7)}</TableCell>
                    <TableCell>{s.changedFileCount}</TableCell>
                    <TableCell>{s.wouldStaleCount}</TableCell>
                    <TableCell className="text-xs">{s.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>
      </RiseIn>

      <Dialog
        open={editing !== null || creating}
        onOpenChange={(open) => { if (!open) { setEditing(null); setCreating(false); } }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{creating ? 'New pinned rule' : 'Edit entry'}</DialogTitle>
          </DialogHeader>
          <EntryForm
            initial={creating || !editing
              ? form
              : { subject: editing.subject, content: editing.content, category: editing.category, tags: editing.tags }}
            onCancel={() => { setEditing(null); setCreating(false); }}
            onSubmit={async (values) => {
              if (creating) {
                await act('create', () => apiFetch('/api/admin/knowledge', jsonBody('POST', values)), () => 'Pinned rule created');
                setForm({ subject: '', content: '', category: 'process', tags: '' });
                setCreating(false);
                // Show the admin what they just wrote instead of losing it.
                setTab('pinned');
              } else if (editing) {
                await act(editing.id, () => patch(editing.id, values), () => 'Saved');
                setEditing(null);
              }
            }}
          />
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

function EntryForm({ initial, onSubmit, onCancel }: {
  initial: { subject: string; content: string; category: string; tags: string };
  onSubmit: (values: { subject: string; content: string; category: string; tags: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  return (
    <form
      onSubmit={async (e) => { e.preventDefault(); setSaving(true); try { await onSubmit(values); } finally { setSaving(false); } }}
      className="space-y-4"
    >
      <Field>
        <FieldLabel htmlFor="entry-subject">Subject</FieldLabel>
        <Input id="entry-subject" value={values.subject} onChange={(e) => setValues({ ...values, subject: e.target.value })} required />
      </Field>
      <Field>
        <FieldLabel htmlFor="entry-content">Content</FieldLabel>
        <Textarea
          id="entry-content"
          rows={5}
          placeholder="Content (plain language)"
          value={values.content}
          onChange={(e) => setValues({ ...values, content: e.target.value })}
          required
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="entry-category">Category</FieldLabel>
        <Select value={values.category} onValueChange={(v) => setValues({ ...values, category: v })}>
          <SelectTrigger id="entry-category" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="entry-tags">Tags</FieldLabel>
        <Input id="entry-tags" placeholder="tags, comma, separated" value={values.tags} onChange={(e) => setValues({ ...values, tags: e.target.value })} />
      </Field>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </DialogFooter>
    </form>
  );
}
