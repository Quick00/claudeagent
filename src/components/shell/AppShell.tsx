'use client';

import type { MouseEvent, ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ConversationsProvider } from '@/components/chat/ConversationsProvider';
import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { SECTIONS, sectionIdForPathname, visibleSections } from '@/lib/navigation';
import { AppRail } from './AppRail';
import { NotificationsProvider } from './NotificationsProvider';
import { SECTION_UI } from './sections';
import { SectionPanel } from './SectionPanel';
import { UserMenu } from './UserMenu';

/**
 * The signed-in user, handed down from the server layout. The role is a prop
 * and never `useSession()`: the rail must know on the very first paint which
 * sections exist, or an admin item flashes in for a plain user.
 */
export type ShellUser = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: string;
};

export function AppShell({ user, children }: { user: ShellUser; children: ReactNode }) {
  return (
    <ConversationsProvider>
      <NotificationsProvider isAdmin={user.role === 'admin'}>
        <ShellFrame user={user}>{children}</ShellFrame>
      </NotificationsProvider>
    </ConversationsProvider>
  );
}

/**
 * Split out so it can call `useSidebar()`: the provider is mounted by the
 * server layout above `AppShell`, which reads the `sidebar_state` cookie.
 */
function ShellFrame({ user, children }: { user: ShellUser; children: ReactNode }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const pathname = usePathname();
  const sectionId = sectionIdForPathname(pathname);
  const title = SECTIONS.find((section) => section.id === sectionId)?.label ?? '';

  if (isMobile) {
    const close = () => setOpenMobile(false);

    return (
      <>
        <Sidebar collapsible="offcanvas">
          <SidebarHeader className="border-b p-2">
            <SectionStrip user={user} onNavigate={close} />
          </SidebarHeader>
          <SidebarContent>
            <SectionPanel className="w-full flex-1" onNavigate={close} />
          </SidebarContent>
          <SidebarFooter className="border-t">
            <UserMenu user={user} showLabel />
          </SidebarFooter>
        </Sidebar>
        <ShellInset title={title}>{children}</ShellInset>
      </>
    );
  }

  return (
    <>
      {/* sidebar-09: one inset sidebar laid out as two columns — icon rail, then panel. */}
      <Sidebar
        variant="inset"
        collapsible="icon"
        className="overflow-hidden *:data-[sidebar=sidebar]:flex-row"
      >
        <AppRail user={user} />
        <SectionPanel className="hidden flex-1 md:flex" />
      </Sidebar>
      <ShellInset title={title}>{children}</ShellInset>
    </>
  );
}

/**
 * The page card. `h-dvh` rather than `h-screen`: on mobile `100vh` sits behind
 * the URL bar, which would push the composer off the bottom of the screen.
 */
function ShellInset({ title, children }: { title: string; children: ReactNode }) {
  return (
    <SidebarInset className="flex h-dvh min-h-0 flex-col overflow-hidden md:h-[calc(100dvh-1rem)]">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <SidebarTrigger />
        <span className="truncate text-sm font-medium">{title}</span>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </SidebarInset>
  );
}

/** The mobile stand-in for the rail: the same sections, laid out across. */
function SectionStrip({ user, onNavigate }: { user: ShellUser; onNavigate: () => void }) {
  const pathname = usePathname();
  const activeId = sectionIdForPathname(pathname);

  // Track 1's conversation rows are plain links with no `onNavigate` of their
  // own, so the sheet also closes on any link click that bubbles out of a panel.
  const closeOnLinkClick = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('a')) onNavigate();
  };

  return (
    <nav
      aria-label="Sections"
      className="no-scrollbar flex items-center gap-1 overflow-x-auto"
      onClickCapture={closeOnLinkClick}
    >
      {visibleSections(user.role).map((section) => {
        const { icon: Icon } = SECTION_UI[section.id];
        return (
          <Button
            key={section.id}
            asChild
            size="sm"
            variant={activeId === section.id ? 'secondary' : 'ghost'}
          >
            <Link href={section.href} onClick={onNavigate}>
              <Icon />
              {section.label}
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}
