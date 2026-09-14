import { Badge } from '@/components/ui/badge';
import type { ComponentProps } from 'react';

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>['variant']>;
type Entry = { label: string; variant: BadgeVariant };

/**
 * Every status pill in the app. Keeping the value → (label, variant) mapping
 * here is what stops each panel from hand-rolling its own palette classes.
 */
const MAPS = {
  userStatus: {
    PENDING: { label: 'Pending', variant: 'warning' },
    APPROVED: { label: 'Approved', variant: 'success' },
    REJECTED: { label: 'Rejected', variant: 'destructive' },
  },
  role: {
    admin: { label: 'Admin', variant: 'default' },
    user: { label: 'User', variant: 'secondary' },
  },
  feedback: {
    TODO: { label: 'To Do', variant: 'warning' },
    DONE: { label: 'Done', variant: 'success' },
  },
  flag: {
    PENDING: { label: 'Pending', variant: 'destructive' },
    RESPONDED: { label: 'Responded', variant: 'success' },
  },
  knowledgeKind: {
    pinned: { label: 'Pinned rule', variant: 'warning' },
    active: { label: 'Active', variant: 'success' },
    retired: { label: 'Retired', variant: 'secondary' },
    stale: { label: 'Stale', variant: 'warning' },
    unverified: { label: 'Unverified', variant: 'outline' },
    fresh: { label: 'Fresh', variant: 'success' },
  },
  reviewType: {
    pinned_conflict: { label: 'Pinned conflict', variant: 'destructive' },
    supersedes: { label: 'Supersedes', variant: 'warning' },
    proposed_update: { label: 'Proposed update', variant: 'outline' },
  },
} as const satisfies Record<string, Record<string, Entry>>;

export type StatusKind = keyof typeof MAPS;

export type StatusBadgeProps = {
  [K in StatusKind]: { kind: K; value: string; className?: string };
}[StatusKind];

export function StatusBadge({ kind, value, className }: StatusBadgeProps) {
  const entry = (MAPS[kind] as Record<string, Entry | undefined>)[value];
  return (
    <Badge variant={entry?.variant ?? 'secondary'} className={className}>
      {entry?.label ?? value}
    </Badge>
  );
}
