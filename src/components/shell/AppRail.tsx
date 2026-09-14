'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { sectionIdForPathname, visibleSections, type Section } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import type { ShellUser } from './AppShell';
import { useNotifications } from './NotificationsProvider';
import { SECTION_UI } from './sections';
import { UserMenu } from './UserMenu';

/**
 * The narrow icon column: one entry per section the user may see, resolved
 * from the role the server handed down so an admin-only item can never flash
 * in for a plain user.
 */
export function AppRail({
  user,
  onNavigate,
  className,
}: {
  user: ShellUser;
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  const activeId = sectionIdForPathname(pathname);
  const { pendingFlags, pendingFeedback } = useNotifications();
  const sections = visibleSections(user.role);

  const renderItem = (section: Section) => {
    const { icon: Icon } = SECTION_UI[section.id];
    // Admin is the only rail item that summarises its children's counts.
    const count = section.id === 'admin' ? pendingFlags + pendingFeedback : 0;

    return (
      <SidebarMenuItem key={section.id}>
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarMenuButton
              asChild
              isActive={activeId === section.id}
              className="size-9 justify-center p-0"
            >
              <Link href={section.href} onClick={onNavigate}>
                <Icon />
                <span className="sr-only">{section.label}</span>
              </Link>
            </SidebarMenuButton>
          </TooltipTrigger>
          <TooltipContent side="right">{section.label}</TooltipContent>
        </Tooltip>
        {count > 0 && (
          <Badge
            variant="destructive"
            className="pointer-events-none absolute -top-1 -right-0.5 h-4 min-w-4 px-1 text-[10px] tabular-nums"
          >
            {count}
          </Badge>
        )}
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar
      collapsible="none"
      className={cn('w-[calc(var(--sidebar-width-icon)+1px)] border-r', className)}
    >
      <SidebarContent>
        <SidebarGroup className="items-center">
          <SidebarMenu className="items-center gap-2">
            {sections.filter((section) => section.placement === 'top').map(renderItem)}
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup className="mt-auto items-center">
          <SidebarMenu className="items-center gap-2">
            {sections.filter((section) => section.placement === 'bottom').map(renderItem)}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="items-center">
        <UserMenu user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
