'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
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
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Field orientation="horizontal" className="rounded-lg border border-border p-3">
        <FieldLabel htmlFor="require-approval" className="flex-col items-start gap-0.5">
          <span className="text-sm">Require approval for new accounts</span>
          <FieldDescription>
            New sign-ups wait for an admin before they can use the app.
          </FieldDescription>
        </FieldLabel>
        <Switch
          id="require-approval"
          checked={data.requireUserApproval}
          onCheckedChange={toggleRequireApproval}
          disabled={savingApproval}
          aria-label="Require approval for new accounts"
        />
      </Field>

      <div className="rounded-lg border border-border p-3">
        <h3 className="text-sm">Files ignored for knowledge provenance</h3>
        <p className="mb-2 text-xs text-muted-foreground">
          One per line. End a line with / for a directory name. These files never count as the source
          of a knowledge entry.
        </p>
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
      </div>
    </div>
  );
}
