import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import NoAccessCard from '@/components/NoAccessCard';
import { authOptions } from '@/lib/auth';
import { isBlockedEmail } from '@/lib/blocked-users';
import { ROUTES } from '@/lib/navigation';

// The proxy sends blocked accounts here. Anyone else who lands on it — or a
// blocked account once its entry is removed from BLOCKED_EMAILS — goes back in.
export default async function NoAccessPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect(ROUTES.login);
  if (!isBlockedEmail(session.user.email)) redirect(ROUTES.chat());

  const firstName = session.user.name?.trim().split(/\s+/)[0] || 'Friend';
  return <NoAccessCard firstName={firstName} />;
}
