'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode } from 'react';
import { ROUTES } from '@/lib/navigation';

/** Routes that must stay reachable while an account is unapproved. */
const EXEMPT_PATHS = [ROUTES.login, ROUTES.pending, '/maintenance'];

/**
 * `getShellUser()` already redirects an unapproved account to `/pending` on
 * the server before anything renders, so this no longer guards the initial
 * load. What it still has to catch is a status change mid-session — an
 * admin revokes access while the tab is already open — which the server
 * guard cannot see until the next navigation.
 */
export default function ApprovalGate({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  const accountStatus = session?.user?.status;
  const blocked =
    status === 'authenticated' && accountStatus !== undefined && accountStatus !== 'APPROVED';
  const shouldRedirect = blocked && !EXEMPT_PATHS.includes(pathname);

  useEffect(() => {
    if (shouldRedirect) router.replace(ROUTES.pending);
  }, [shouldRedirect, router]);

  if (shouldRedirect) return null;

  return <>{children}</>;
}
