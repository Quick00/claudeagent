'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { Circle, CircleCheck, Laptop, Moon, Sun } from 'lucide-react';
import { apiFetch, jsonBody } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { PageContainer } from '@/components/shared/PageContainer';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import LinkClaudeModal from '@/components/LinkClaudeModal';

type ClaudeStatus = { linked: boolean; email: string | null };

/**
 * The user-facing half of the old `SettingsPanel`: the Claude account link
 * and appearance controls. Mounted at `/settings` with no modal wrapper —
 * the page itself provides the chrome.
 */
export default function UserSettings() {
  const { data: session } = useSession();
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  // next-themes can't know the resolved theme on the server (it lives in
  // localStorage), so the server always renders as if theme were unset. Until
  // this effect fires on the client, don't assert a selection — otherwise the
  // server's guess and the client's real value briefly disagree and React
  // (and assistive tech reading aria-checked from the server HTML) sees a
  // hydration mismatch.
  const [mounted, setMounted] = useState(false);

  // Deliberate mount-detection idiom for the hydration-safety gate described
  // above; the "fix" the rule below suggests (deriving this from an external
  // store) is what would reintroduce the mismatch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const statusQuery = useQuery({
    queryKey: qk.claude.status(),
    queryFn: ({ signal }) => apiFetch<ClaudeStatus>('/api/auth/claude/status', { signal }),
  });
  const claudeStatus = statusQuery.data ?? null;

  const unlinkMutation = useMutation({
    mutationFn: () => apiFetch('/api/auth/claude/unlink', jsonBody('POST')),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.claude.status() });
    },
    onError: () => {
      toast.error('Failed to unlink Claude account');
    },
  });

  const handleUnlink = () => {
    unlinkMutation.mutate();
  };

  // The link mutation itself lives in LinkClaudeModal (it owns the token
  // form); on success it invalidates the status query directly, so by the
  // time this fires the card already has fresh data. This just closes the
  // modal.
  const handleLinked = () => {
    setModalOpen(false);
  };

  return (
    <PageContainer width="form">
      <PageHeader title="Settings" description="Manage your account and appearance." />

      <Card>
        <CardHeader>
          <CardTitle>App Account</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{session?.user?.email}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Claude Account</CardTitle>
        </CardHeader>
        <CardContent>
          {statusQuery.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : statusQuery.isError ? (
            <p className="text-sm text-destructive">Couldn&rsquo;t load your Claude account status.</p>
          ) : claudeStatus?.linked ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <CircleCheck className="size-4 text-success" />
                <span className="text-sm">Connected</span>
                {claudeStatus.email && (
                  <span className="text-sm text-muted-foreground">({claudeStatus.email})</span>
                )}
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleUnlink}
                disabled={unlinkMutation.isPending}
              >
                {unlinkMutation.isPending ? 'Unlinking…' : 'Unlink Claude Account'}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Circle className="size-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Not connected</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Link your Claude account to start asking questions. Requires a Claude Max, Pro, or
                Team subscription.
              </p>
              <Button size="sm" onClick={() => setModalOpen(true)}>
                Link Claude Account
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <ToggleGroup
            type="single"
            variant="outline"
            value={mounted ? (theme ?? 'system') : ''}
            onValueChange={(value) => {
              if (value) setTheme(value);
            }}
          >
            <ToggleGroupItem value="system" aria-label="System" className="h-auto w-24 flex-col gap-1.5 py-3">
              <Laptop className="size-5" />
              System
            </ToggleGroupItem>
            <ToggleGroupItem value="light" aria-label="Light" className="h-auto w-24 flex-col gap-1.5 py-3">
              <Sun className="size-5" />
              Light
            </ToggleGroupItem>
            <ToggleGroupItem value="dark" aria-label="Dark" className="h-auto w-24 flex-col gap-1.5 py-3">
              <Moon className="size-5" />
              Dark
            </ToggleGroupItem>
          </ToggleGroup>
        </CardContent>
      </Card>

      <LinkClaudeModal open={modalOpen} onOpenChange={setModalOpen} onLinked={handleLinked} />
    </PageContainer>
  );
}
