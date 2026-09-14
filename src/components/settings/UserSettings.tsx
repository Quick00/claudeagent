'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useTheme } from 'next-themes';
import { Circle, CircleCheck, Laptop, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus | null>(null);
  const [unlinking, setUnlinking] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const fetchStatus = () => {
    fetch('/api/auth/claude/status')
      .then((res) => res.json())
      .then(setClaudeStatus)
      .catch(console.error);
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleUnlink = async () => {
    setUnlinking(true);
    try {
      await fetch('/api/auth/claude/unlink', { method: 'POST' });
      setClaudeStatus({ linked: false, email: null });
    } catch (err) {
      console.error('Failed to unlink:', err);
    } finally {
      setUnlinking(false);
    }
  };

  const handleLinked = () => {
    setModalOpen(false);
    fetchStatus();
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-1 text-sm font-medium">App Account</h3>
        <p className="text-sm text-muted-foreground">{session?.user?.email}</p>
      </div>

      <div className="border-t border-border pt-4">
        <h3 className="mb-3 text-sm font-medium">Claude Account</h3>

        {claudeStatus === null ? (
          <Skeleton className="h-16 w-full" />
        ) : claudeStatus.linked ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <CircleCheck className="size-4 text-success" />
              <span className="text-sm">Connected</span>
              {claudeStatus.email && (
                <span className="text-sm text-muted-foreground">({claudeStatus.email})</span>
              )}
            </div>
            <Button variant="destructive" size="sm" onClick={handleUnlink} disabled={unlinking}>
              {unlinking ? 'Unlinking…' : 'Unlink Claude Account'}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Circle className="size-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Not connected</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Link your Claude account to start asking questions. Requires a Claude Max, Pro, or Team
              subscription.
            </p>
            <Button size="sm" onClick={() => setModalOpen(true)}>
              Link Claude Account
            </Button>
          </div>
        )}
      </div>

      <div className="border-t border-border pt-4">
        <h3 className="mb-3 text-sm font-medium">Appearance</h3>
        <ToggleGroup
          type="single"
          variant="outline"
          value={theme ?? 'system'}
          onValueChange={(value) => {
            if (value) setTheme(value);
          }}
          className="w-full"
        >
          <ToggleGroupItem value="system" aria-label="System" className="flex-1 flex-col gap-1.5 py-3">
            <Laptop className="size-5" />
            System
          </ToggleGroupItem>
          <ToggleGroupItem value="light" aria-label="Light" className="flex-1 flex-col gap-1.5 py-3">
            <Sun className="size-5" />
            Light
          </ToggleGroupItem>
          <ToggleGroupItem value="dark" aria-label="Dark" className="flex-1 flex-col gap-1.5 py-3">
            <Moon className="size-5" />
            Dark
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <LinkClaudeModal open={modalOpen} onOpenChange={setModalOpen} onLinked={handleLinked} />
    </div>
  );
}
