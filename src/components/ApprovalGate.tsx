'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode } from 'react';

/** Routes that must stay reachable while an account is unapproved. */
const EXEMPT_PATHS = ['/login', '/pending', '/maintenance'];

/**
 * Keeps unapproved accounts out of the app UI. The API guards are what actually
 * protect the data; this is so those users see the pending screen instead of a
 * broken page.
 */
export default function ApprovalGate({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  const accountStatus = (session?.user as Record<string, unknown> | undefined)?.status;
  const blocked =
    status === 'authenticated' && accountStatus !== undefined && accountStatus !== 'APPROVED';
  const shouldRedirect = blocked && !EXEMPT_PATHS.includes(pathname);

  useEffect(() => {
    if (shouldRedirect) router.replace('/pending');
  }, [shouldRedirect, router]);

  if (shouldRedirect) return null;

  return <>{children}</>;
}
