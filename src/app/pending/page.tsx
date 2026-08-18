'use client';

import { useEffect, useRef, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

const POLL_SECONDS = 10;

export default function PendingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [countdown, setCountdown] = useState(POLL_SECONDS);
  const [rejected, setRejected] = useState(false);
  const probing = useRef(false);

  const accountStatus = (session?.user as Record<string, unknown> | undefined)?.status;

  // Nobody should sit on this screen if they can already get in, or aren't signed in.
  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
    if (status === 'authenticated' && accountStatus === 'APPROVED') router.replace('/');
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
                window.location.href = '/';
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
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="w-full max-w-md px-6 text-center">
        <div className="mb-8 flex justify-center">
          <span
            className={`flex h-20 w-20 items-center justify-center rounded-full ${
              rejected ? 'bg-red-100 dark:bg-red-950' : 'bg-blue-100 dark:bg-blue-950'
            }`}
          >
            {rejected ? (
              <svg
                className="h-10 w-10 text-red-600 dark:text-red-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg
                className="h-10 w-10 animate-pulse text-blue-600 dark:text-blue-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            )}
          </span>
        </div>

        {rejected ? (
          <>
            <h1 className="mb-3 text-2xl font-bold text-gray-900 dark:text-gray-100">
              Access not granted
            </h1>
            <p className="mb-6 text-gray-500 dark:text-gray-400">
              An admin declined access for this account. Get in touch with your team if you think
              this is a mistake.
            </p>
          </>
        ) : (
          <>
            <h1 className="mb-3 text-2xl font-bold text-gray-900 dark:text-gray-100">
              Waiting for approval
            </h1>
            <p className="mb-6 text-gray-500 dark:text-gray-400">
              Your account has been created and the admins have been notified. You&apos;ll get access
              as soon as someone approves it — this page updates itself.
            </p>
            <p className="mb-6 text-xs text-gray-400 dark:text-gray-600">
              Checking again in {countdown}s...
            </p>
          </>
        )}

        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
