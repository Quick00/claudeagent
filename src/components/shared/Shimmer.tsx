import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Text that is doing something. Use it for transient progress copy — a tool
 * call, a "Thinking…" line — never for static text, where a moving highlight
 * is just noise.
 *
 * `aria-live="polite"` is on by default because this text usually replaces
 * itself as work progresses, and a screen reader user should hear that
 * without the announcement interrupting them. Pass `live={false}` when the
 * surrounding region already announces.
 */
export function Shimmer({
  children,
  live = true,
  className,
}: {
  children: ReactNode;
  live?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn('text-shimmer', className)}
      {...(live ? { 'aria-live': 'polite' as const } : {})}
    >
      {children}
    </span>
  );
}
