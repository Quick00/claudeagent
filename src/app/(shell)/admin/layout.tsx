import { redirect } from 'next/navigation';
import { ROUTES } from '@/lib/navigation';
import { getShellUser } from '@/lib/shell-user';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Deduped with the shell layout's call by React cache(). The API guards
  // remain authoritative: this only keeps the UI out of a non-admin's hands.
  const user = await getShellUser();
  if (user.role !== 'admin') {
    redirect(ROUTES.chat());
  }
  return <>{children}</>;
}
