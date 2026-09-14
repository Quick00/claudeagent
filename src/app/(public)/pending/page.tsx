'use client';

import { useEffect, useRef, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Clock, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ROUTES } from '@/lib/navigation';

const POLL_SECONDS = 10;

export default function PendingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [countdown, setCountdown] = useState(POLL_SECONDS);
  const [rejected, setRejected] = useState(false);
  const probing = useRef(false);

  const accountStatus = session?.user?.status;

  // Nobody should sit on this screen if they can already get in, or aren't signed in.
  useEffect(() => {
    if (status === 'unauthenticated') router.replace(ROUTES.login);
    if (status === 'authenticated' && accountStatus === 'APPROVED') router.replace(ROUTES.chat());
  }, [status, accountStatus, router]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev > 1) return prev - 1;
        if (!probing.current) {
          probing.current = true;
          fetch('/api/account-status')
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
              if (data?.status === 'APPROVED') {
                window.location.href = ROUTES.chat();
              } else if (data?.status === 'REJECTED') {
                setRejected(true);
              }
            })
            .catch(() => {})
            .finally(() => {
              probing.current = false;
            });
        }
        return POLL_SECONDS;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <Card className="w-full max-w-md">
      <CardContent className="px-6 py-8 text-center">
        <div className="mb-8 flex justify-center">
          <span
            className={`flex size-20 items-center justify-center rounded-full ${
              rejected ? 'bg-destructive/10' : 'bg-primary/10'
            }`}
          >
            {rejected ? (
              <XCircle className="size-10 text-destructive" />
            ) : (
              <Clock className="size-10 animate-pulse text-primary" />
            )}
          </span>
        </div>

        {rejected ? (
          <>
            <h1 className="mb-3 text-2xl font-bold">Access not granted</h1>
            <p className="mb-6 text-muted-foreground">
              An admin declined access for this account. Get in touch with your team if you think
              this is a mistake.
            </p>
          </>
        ) : (
          <>
            <h1 className="mb-3 text-2xl font-bold">Waiting for approval</h1>
            <p className="mb-6 text-muted-foreground">
              Your account has been created and the admins have been notified. You&apos;ll get access
              as soon as someone approves it — this page updates itself.
            </p>
            <p className="mb-6 text-xs text-muted-foreground">Checking again in {countdown}s...</p>
          </>
        )}

        <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: ROUTES.login })}>
          Sign out
        </Button>
      </CardContent>
    </Card>
  );
}
