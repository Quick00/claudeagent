'use client';

import { ShieldAlert } from 'lucide-react';

/**
 * Shown above the thread when an admin is reading (and can post into) someone
 * else's conversation. Messages still run on the owner's Claude account, which
 * is the part an admin has to know before typing.
 */
export function AdminViewBanner({ ownerName }: { ownerName: string }) {
  return (
    <div className="flex items-start gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2 text-xs text-foreground">
      <ShieldAlert className="mt-px size-3.5 shrink-0 text-warning" />
      <p>
        <span className="font-medium">Admin view</span> — you are posting in {ownerName}&apos;s
        conversation. Messages you send go to Claude using {ownerName}&apos;s account.
      </p>
    </div>
  );
}

/** Why the composer is disabled for an admin looking at a thread they cannot post to. */
export function AdminSendBlockedNotice({ reason }: { reason: 'no-token' | 'not-started' }) {
  return (
    <p className="border-t border-border px-4 py-2 text-center text-xs text-muted-foreground">
      {reason === 'no-token'
        ? 'Owner has not linked a Claude account.'
        : 'Owner has not started this conversation yet.'}
    </p>
  );
}
