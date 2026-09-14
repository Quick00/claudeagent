import { cache } from 'react';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { ROUTES } from '@/lib/navigation';
import { USER_STATUS } from '@/lib/user-approval';

export type ShellUser = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: string;
};

/**
 * The signed-in, approved user for a shell route. Wrapped in React `cache()`
 * so `(shell)/layout.tsx` and `(shell)/admin/layout.tsx` share one session
 * query per request.
 *
 * Role reaches the rail as a server prop from here, never from `useSession()`,
 * so admin items never flash in for a plain user.
 */
export const getShellUser = cache(async (): Promise<ShellUser> => {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect(ROUTES.login);
  }

  if (session.user.status !== USER_STATUS.approved) {
    redirect(ROUTES.pending);
  }

  return {
    id: session.user.id,
    name: session.user.name ?? null,
    email: session.user.email ?? null,
    image: session.user.image ?? null,
    role: session.user.role,
  };
});
