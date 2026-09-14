'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/EmptyState';

export default function ShellError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  // Scoped to the inset, so the rail and panel stay mounted and the user can
  // navigate away instead of losing the whole shell.
  return (
    <div className="flex h-full items-center justify-center p-6">
      <EmptyState
        icon={AlertTriangle}
        title="Something went wrong"
        description="This page failed to load. The error has been reported."
        action={<Button onClick={reset}>Try again</Button>}
      />
    </div>
  );
}
