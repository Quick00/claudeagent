'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiFetch, jsonBody } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageContainer } from '@/components/shared/PageContainer';
import { PageHeader } from '@/components/shared/PageHeader';
import { RiseIn } from '@/components/shared/RiseIn';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useDeferredSkeleton } from '@/hooks/use-deferred-skeleton';

type AdminSettingsData = {
  requireUserApproval: boolean;
  knowledgeIgnorePatterns: string;
};

/**
 * The admin-only half of the old `SettingsPanel`. Mounted at `/admin/settings`
 * behind the server-side admin route guard, so unlike the panel it replaces
 * this never needs to probe whether the current user is an admin.
 */
export default function AdminSettings() {
  const queryClient = useQueryClient();
  const [ignoreText, setIgnoreText] = useState('');
  const [ignoreDirty, setIgnoreDirty] = useState(false);
  // The ignore-patterns textarea is a local edit buffer, seeded once from the
  // first successful load — not resynced on every refetch, or an unrelated
  // invalidation (e.g. toggling approval) would clobber an in-progress edit.
  const seededIgnoreText = useRef(false);

  const settingsQuery = useQuery({
    queryKey: qk.settings.admin(),
    queryFn: ({ signal }) => apiFetch<AdminSettingsData>('/api/admin/settings', { signal }),
  });
  const data = settingsQuery.data;

  // Deliberate one-time seed of a local edit buffer from server data (see
  // comment on `seededIgnoreText` above); it must not re-run on every
  // refetch, so it can't be expressed as a plain derived value.
  useEffect(() => {
    if (data && !seededIgnoreText.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIgnoreText(data.knowledgeIgnorePatterns ?? '');
      seededIgnoreText.current = true;
    }
  }, [data]);

  const approvalMutation = useMutation({
    mutationFn: (next: boolean) =>
      apiFetch('/api/admin/settings', jsonBody('PATCH', { requireUserApproval: next })),
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: qk.settings.admin() });
      const previous = queryClient.getQueryData<AdminSettingsData>(qk.settings.admin());
      queryClient.setQueryData<AdminSettingsData | undefined>(qk.settings.admin(), (old) =>
        old ? { ...old, requireUserApproval: next } : old,
      );
      return { previous };
    },
    onError: (_err, _next, context) => {
      if (context?.previous) {
        queryClient.setQueryData(qk.settings.admin(), context.previous);
      }
      toast.error('Failed to update approval setting');
    },
  });

  const toggleRequireApproval = (next: boolean) => {
    approvalMutation.mutate(next);
  };

  const savePatternsMutation = useMutation({
    mutationFn: (patterns: string) =>
      apiFetch('/api/admin/settings', jsonBody('PATCH', { knowledgeIgnorePatterns: patterns })),
    onSuccess: () => {
      toast.success('Saved');
      setIgnoreDirty(false);
      queryClient.invalidateQueries({ queryKey: qk.settings.admin() });
    },
    onError: () => {
      toast.error('Failed to save ignore patterns');
    },
  });

  const saveIgnorePatterns = () => {
    savePatternsMutation.mutate(ignoreText);
  };

  const showSkeleton = useDeferredSkeleton(settingsQuery.isPending);

  if (!data) {
    if (settingsQuery.isError) {
      return (
        <PageContainer width="form">
          <PageHeader title="Admin Settings" description="Account approval and knowledge provenance." />
          <EmptyState title="Couldn't load settings" description="Try refreshing the page." />
        </PageContainer>
      );
    }
    if (!showSkeleton) return null;
    return (
      <PageContainer width="form">
        <PageHeader title="Admin Settings" description="Account approval and knowledge provenance." />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </PageContainer>
    );
  }

  return (
    <PageContainer width="form">
      <RiseIn delay={0}>
        <PageHeader title="Admin Settings" description="Account approval and knowledge provenance." />
      </RiseIn>

      <RiseIn delay={0.06}>
        <Card>
          <CardHeader>
            <CardTitle>Account approval</CardTitle>
            <CardDescription>New sign-ups wait for an admin before they can use the app.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="require-approval" className="text-sm font-normal">
                Require approval for new accounts
              </Label>
              <Switch
                id="require-approval"
                checked={data.requireUserApproval}
                onCheckedChange={toggleRequireApproval}
                disabled={approvalMutation.isPending}
                aria-label="Require approval for new accounts"
              />
            </div>
          </CardContent>
        </Card>
      </RiseIn>

      <RiseIn delay={0.12}>
        <Card>
          <CardHeader>
            <CardTitle>Knowledge provenance</CardTitle>
            <CardDescription>
              Files ignored when attributing a knowledge entry to its source. One per line — end a
              line with / for a directory name.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              value={ignoreText}
              onChange={(e) => {
                setIgnoreText(e.target.value);
                setIgnoreDirty(true);
              }}
              rows={5}
              className="font-mono text-xs"
            />
            <div className="mt-2">
              <Button size="sm" onClick={saveIgnorePatterns} disabled={savePatternsMutation.isPending || !ignoreDirty}>
                {savePatternsMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </RiseIn>
    </PageContainer>
  );
}
