'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { isActiveHref, type BadgeKey, type SectionChild } from '@/lib/navigation';
import { CHILD_ICONS } from '../icons';
import { useNotifications } from '../NotificationsProvider';

/** The list of pages inside one section, with live counts on the ones that badge. */
export function SubNav({
  items,
  onNavigate,
}: {
  items: SectionChild[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { pendingFlags, pendingFeedback } = useNotifications();
  const counts: Record<BadgeKey, number> = { pendingFlags, pendingFeedback };

  return (
    <SidebarGroup>
      <SidebarMenu>
        {items.map((item) => {
          const count = item.badge ? counts[item.badge] : 0;
          const Icon = CHILD_ICONS[item.icon];
          return (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton asChild isActive={isActiveHref(item.href, pathname)}>
                <Link href={item.href} onClick={onNavigate}>
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                  {count > 0 && (
                    <Badge variant="secondary" className="ml-auto tabular-nums">
                      {count}
                    </Badge>
                  )}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
