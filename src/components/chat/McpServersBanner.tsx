'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { PlugZap, X } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { ROUTES } from '@/lib/navigation';
import { qk } from '@/lib/query-keys';

interface McpServer {
  id: string;
  name: string;
  connectionStatus: 'CONNECTED' | 'ERROR' | 'NOT_CONNECTED';
}

const DISMISSED_KEY = 'mcp-servers-banner-dismissed';
const list = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });

const dismissedListeners = new Set<() => void>();
function subscribeDismissed(notify: () => void) {
  dismissedListeners.add(notify);
  return () => dismissedListeners.delete(notify);
}
function readDismissed() {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

/** Tells the user which connected tools Claude can use here, and which still need connecting. */
export function McpServersBanner() {
  const { data } = useQuery({
    queryKey: qk.mcpServers.userList(),
    queryFn: ({ signal }) => apiFetch<McpServer[]>('/api/mcp-servers', { signal }),
  });
  const dismissedSignature = useSyncExternalStore(subscribeDismissed, readDismissed, () => undefined);

  const servers = Array.isArray(data) ? data : [];
  // A newly registered server changes the signature, so it brings the banner back.
  const signature = servers.map((s) => s.id).sort().join(',');
  if (servers.length === 0 || dismissedSignature === undefined || dismissedSignature === signature) {
    return null;
  }

  const connected = servers.filter((s) => s.connectionStatus === 'CONNECTED').map((s) => s.name);
  const unconnected = servers.filter((s) => s.connectionStatus !== 'CONNECTED').map((s) => s.name);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, signature);
    } catch {
      // Dismissal only lasts for this page view when storage is blocked.
    }
    dismissedListeners.forEach((notify) => notify());
  };

  return (
    <div className="flex items-start gap-2 border-b border-primary/30 bg-primary/10 px-4 py-2 text-xs text-foreground">
      <PlugZap className="mt-px size-3.5 shrink-0 text-primary" />
      <p className="flex-1">
        {connected.length > 0 && (
          <>
            Claude can also use <span className="font-medium">{list.format(connected)}</span> in this chat.{' '}
          </>
        )}
        {unconnected.length > 0 && (
          <>
            <span className="font-medium">{list.format(unconnected)}</span> can be connected.{' '}
          </>
        )}
        <Link href={ROUTES.settings} className="text-primary underline underline-offset-2">
          Manage connections
        </Link>
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
