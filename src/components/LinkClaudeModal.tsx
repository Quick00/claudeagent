'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Copy } from 'lucide-react';
import { apiFetch, jsonBody } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

type DetectedOs = 'mac' | 'windows' | 'linux';

function detectOs(): DetectedOs {
  if (typeof navigator === 'undefined') return 'mac';
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'windows';
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return 'linux';
  return 'mac';
}

interface LinkClaudeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked: () => void;
}

export default function LinkClaudeModal({ open, onOpenChange, onLinked }: LinkClaudeModalProps) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState('');
  const [os, setOs] = useState<DetectedOs>(() => detectOs());
  const [copied, setCopied] = useState(false);

  const linkMutation = useMutation({
    mutationFn: (cleanedToken: string) =>
      apiFetch('/api/auth/claude/link', jsonBody('POST', { token: cleanedToken })),
    onSuccess: () => {
      toast.success('Claude account linked');
      setToken('');
      queryClient.invalidateQueries({ queryKey: qk.claude.status() });
      onLinked();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    },
  });

  const downloadHref = '/install/install-claude-windows.bat';
  const downloadFilename = 'install-claude.bat';

  const macInstallCommand = (() => {
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    return `curl -fsSL ${base}/install/install-mac.sh | bash`;
  })();

  const copyToClipboard = async (text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error('clipboard unavailable');
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-secure contexts (HTTP on LAN): use a temporary
      // textarea + document.execCommand('copy'). execCommand is deprecated
      // but universally works and is the standard fallback for this case.
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        toast.error('Could not copy — select the command manually');
      } finally {
        document.body.removeChild(textarea);
      }
    }
  };

  // Closing the dialog — Cancel, Escape, or an overlay click — drops the
  // pasted token from state rather than leaving a live credential sitting in
  // memory (and ready to repopulate the textarea) until the next link flow.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setToken('');
      linkMutation.reset();
    }
    onOpenChange(next);
  };

  const handleSubmit = () => {
    const cleaned = token.replace(/\s+/g, '');
    if (!cleaned) return;
    linkMutation.mutate(cleaned);
  };

  const installSteps =
    os === 'windows' ? (
      <>
        <Button asChild className="w-full">
          <a href={downloadHref} download={downloadFilename}>
            Download installer for Windows
          </a>
        </Button>
        <div className="mt-3 space-y-2 text-xs text-muted-foreground">
          <p>
            1. Open the downloaded <code className="font-mono">install-claude.bat</code> file.
          </p>
          <p>
            2. If Windows shows <b>&ldquo;Windows protected your PC&rdquo;</b>, click <b>More info</b>,
            then <b>Run anyway</b>.
          </p>
          <p>
            3. A command window opens and installs Claude (and Git for Windows, if missing). A browser
            opens for you to log in. When finished, a long token is printed in the command window —
            copy it and paste it below.
          </p>
        </div>
      </>
    ) : os === 'linux' ? (
      <>
        <div className="space-y-2 text-sm">
          <p>
            <b>1.</b> Open a terminal on your computer.
          </p>
          <p>
            <b>2.</b> Click the <b>Copy</b> button below, paste the command into the terminal, and
            press <Kbd>Enter</Kbd>.
          </p>
        </div>
        <div className="mt-3 flex min-w-0 items-center justify-between gap-2 rounded-md bg-foreground px-3 py-2">
          <code className="min-w-0 flex-1 break-all text-sm text-background">{macInstallCommand}</code>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-2 shrink-0 text-background hover:bg-background/10 hover:text-background"
            onClick={() => copyToClipboard(macInstallCommand)}
            aria-label="Copy install command"
          >
            {copied ? <Check /> : <Copy />}
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          <b>3.</b> A browser window will open for you to log in with your Claude account. After you
          authorize, a long token is printed in the terminal window — copy it and paste it below.
        </p>
      </>
    ) : (
      <>
        <div className="space-y-2 text-sm">
          <p>
            <b>1.</b> Press <Kbd>⌘</Kbd> + <Kbd>Space</Kbd> on your keyboard to open Spotlight.
          </p>
          <p>
            <b>2.</b> Type <b>Terminal</b> and press <Kbd>Enter</Kbd>. A terminal window will open.
          </p>
          <p>
            <b>3.</b> Click the <b>Copy</b> button below, paste the command into the terminal (
            <Kbd>⌘</Kbd> + <Kbd>V</Kbd>), and press <Kbd>Enter</Kbd>.
          </p>
        </div>
        <div className="mt-3 flex min-w-0 items-center justify-between gap-2 rounded-md bg-foreground px-3 py-2">
          <code className="min-w-0 flex-1 break-all text-sm text-background">{macInstallCommand}</code>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-2 shrink-0 text-background hover:bg-background/10 hover:text-background"
            onClick={() => copyToClipboard(macInstallCommand)}
            aria-label="Copy install command"
          >
            {copied ? <Check /> : <Copy />}
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          <b>4.</b> A browser window will open for you to log in with your Claude account. After you
          authorize, a long token is printed in the terminal window — copy it and paste it below.
        </p>
      </>
    );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Link your Claude account</DialogTitle>
          <DialogDescription>
            To use this app, you need a Claude subscription (Max, Pro, or Team) and a setup token.
            Follow the steps below to generate one.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <div className="min-w-0 rounded-lg bg-muted p-4">
            <h3 className="mb-2 text-sm font-semibold">Step 1: Install Claude and get your token</h3>
            <ToggleGroup
              type="single"
              variant="outline"
              spacing={0}
              value={os === 'linux' ? undefined : os}
              onValueChange={(value) => {
                if (value) setOs(value as DetectedOs);
              }}
              className="mb-3 text-xs"
            >
              <ToggleGroupItem value="mac">macOS</ToggleGroupItem>
              <ToggleGroupItem value="windows">Windows</ToggleGroupItem>
            </ToggleGroup>

            {installSteps}
          </div>

          <div className="min-w-0 rounded-lg bg-muted p-4">
            <h3 className="mb-2 text-sm font-semibold">Step 2: Paste your token</h3>
            <p className="mb-2 text-sm text-muted-foreground">
              Copy the token from your terminal and paste it below:
            </p>
            <Textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste your Claude token here..."
              rows={3}
              className="w-full resize-none break-all font-mono"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={linkMutation.isPending || !token.replace(/\s+/g, '')}>
            {linkMutation.isPending ? 'Saving...' : 'Link Account'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
