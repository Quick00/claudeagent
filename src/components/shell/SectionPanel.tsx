'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sidebar, SidebarContent, SidebarHeader } from '@/components/ui/sidebar';
import { ROUTES } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { panelForPathname } from './sections';

/**
 * The contextual second column. Which body it shows follows the URL, not a
 * click: deep-linking into `/admin/flags` opens the admin panel the same way
 * clicking the rail does. Sections with no panel (Settings) render nothing at
 * all; `AppShell` narrows the sidebar to the rail on those routes so the space
 * this would have taken goes to the page.
 */
export function SectionPanel({
  onNavigate,
  className,
}: {
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  const active = panelForPathname(pathname);

  if (!active) return null;
  const { section, Panel } = active;

  return (
    <Sidebar collapsible="none" className={cn('min-w-0', className)}>
      <SidebarHeader className="h-12 shrink-0 flex-row items-center justify-between gap-2 border-b px-4">
        <span className="truncate text-sm font-medium">{section.label}</span>
        {section.id === 'chat' && (
          <Button asChild variant="outline" size="sm">
            <Link href={ROUTES.chat()} onClick={onNavigate}>
              <Plus />
              New chat
            </Link>
          </Button>
        )}
      </SidebarHeader>
      <SidebarContent>
        <Panel section={section} onNavigate={onNavigate} />
      </SidebarContent>
    </Sidebar>
  );
}
