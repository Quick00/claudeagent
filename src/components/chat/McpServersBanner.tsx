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

/** Points the user at MCP servers they have not connected yet, or whose connection broke. */
export function McpServersBanner() {
  const { data } = useQuery({
    queryKey: qk.mcpServers.userList(),
    queryFn: ({ signal }) => apiFetch<McpServer[]>('/api/mcp-servers', { signal }),
  });
  const dismissed = useSyncExternalStore(subscribeDismissed, readDismissed, () => undefined);

  const servers = Array.isArray(data) ? data : [];
  const broken = servers.filter((s) => s.connectionStatus === 'ERROR');
  const unconnected = servers.filter((s) => s.connectionStatus === 'NOT_CONNECTED');
  // One key per server and status, so a dismissal hides what was shown but a
  // newly registered server, or a connection that breaks, brings it back.
  const shown = [...broken, ...unconnected].map((s) => `${s.id}:${s.connectionStatus}`);
  if (shown.length === 0 || dismissed === undefined) return null;
  const dismissedKeys = new Set(dismissed?.split(',') ?? []);
  if (shown.every((key) => dismissedKeys.has(key))) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, shown.join(','));
    } catch {
      // Dismissal only lasts for this page view when storage is blocked.
    }
    dismissedListeners.forEach((notify) => notify());
  };

  return (
    <div className="flex items-start gap-2 border-b border-primary/30 bg-primary/10 px-4 py-2 text-xs text-foreground">
      <PlugZap className="mt-px size-3.5 shrink-0 text-primary" />
      <p className="flex-1">
        {broken.length > 0 && (
          <>
            <span className="font-medium">{list.format(broken.map((s) => s.name))}</span>{' '}
            {broken.length === 1 ? 'needs' : 'need'} reconnecting.{' '}
          </>
        )}
        {unconnected.length > 0 && (
          <>
            <span className="font-medium">{list.format(unconnected.map((s) => s.name))}</span> can be connected.{' '}
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
