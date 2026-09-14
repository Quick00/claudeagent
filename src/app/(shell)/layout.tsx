import { cookies } from 'next/headers';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AppShell } from '@/components/shell/AppShell';
import { getShellUser } from '@/lib/shell-user';

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  // getShellUser() redirects to /login or /pending; it is cache()-wrapped, so
  // the nested admin layout reuses this same session query.
  const user = await getShellUser();
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar_state')?.value !== 'false';

  return (
    <SidebarProvider
      defaultOpen={defaultOpen}
      // The rail and the panel share this width, and the 16rem default would
      // leave the panel about 13rem. It cannot be set lower down: the gap
      // element and the container are siblings.
      style={{ '--sidebar-width': '22rem' } as React.CSSProperties}
    >
      <AppShell user={user}>{children}</AppShell>
    </SidebarProvider>
  );
}
