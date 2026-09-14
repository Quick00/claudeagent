'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

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
  const [data, setData] = useState<AdminSettingsData | null>(null);
  const [savingApproval, setSavingApproval] = useState(false);
  const [ignoreText, setIgnoreText] = useState('');
  const [ignoreDirty, setIgnoreDirty] = useState(false);
  const [ignoreSaving, setIgnoreSaving] = useState(false);

  useEffect(() => {
    fetch('/api/admin/settings')
      .then((res) => (res.ok ? res.json() : null))
      .then((json: AdminSettingsData | null) => {
        if (json) {
          setData(json);
          setIgnoreText(json.knowledgeIgnorePatterns ?? '');
        }
      })
      .catch(() => {});
  }, []);

  const toggleRequireApproval = async (next: boolean) => {
    if (!data) return;
    setSavingApproval(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requireUserApproval: next }),
      });
      if (res.ok) {
        setData({ ...data, requireUserApproval: next });
      } else {
        toast.error('Failed to update approval setting');
      }
    } catch {
      toast.error('Failed to update approval setting');
    } finally {
      setSavingApproval(false);
    }
  };

  const saveIgnorePatterns = async () => {
    setIgnoreSaving(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ knowledgeIgnorePatterns: ignoreText }),
      });
      if (res.ok) {
        toast.success('Saved');
        setIgnoreDirty(false);
      } else {
        toast.error('Failed to save ignore patterns');
      }
    } catch {
      toast.error('Failed to save ignore patterns');
    } finally {
      setIgnoreSaving(false);
    }
  };

  if (data === null) {
    return (
      <div className="max-w-2xl space-y-6 p-6">
        <PageHeader title="Admin Settings" description="Account approval and knowledge provenance." />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6 p-6">
      <PageHeader title="Admin Settings" description="Account approval and knowledge provenance." />

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
              disabled={savingApproval}
              aria-label="Require approval for new accounts"
            />
          </div>
        </CardContent>
      </Card>

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
            <Button size="sm" onClick={saveIgnorePatterns} disabled={ignoreSaving || !ignoreDirty}>
              {ignoreSaving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
