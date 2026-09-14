'use client';

import { createContext, use, useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm action as destructive. Defaults to true. */
  destructive?: boolean;
};

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Promise-returning replacement for `window.confirm`, backed by one shared
 * AlertDialog. Mounted once in `Providers`.
 */
export function useConfirm(): ConfirmFn {
  const confirm = use(ConfirmContext);
  if (!confirm) {
    throw new Error('useConfirm must be used within a ConfirmDialogProvider');
  }
  return confirm;
}

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((next) => {
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    setOptions(null);
    resolveRef.current?.(ok);
    resolveRef.current = null;
  }, []);

  // `onOpenChange(false)` covers Escape and overlay clicks, which must resolve
  // the promise too or the caller hangs forever.
  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext value={value}>
      {children}
      <AlertDialog open={options !== null} onOpenChange={(open) => !open && settle(false)}>
        {options && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{options.title}</AlertDialogTitle>
              {options.description && (
                <AlertDialogDescription>{options.description}</AlertDialogDescription>
              )}
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => settle(false)}>
                {options.cancelLabel ?? 'Cancel'}
              </AlertDialogCancel>
              <AlertDialogAction
                className={cn(
                  options.destructive !== false &&
                    buttonVariants({ variant: 'destructive' }),
                )}
                onClick={() => settle(true)}
              >
                {options.confirmLabel ?? 'Continue'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </ConfirmContext>
  );
}
