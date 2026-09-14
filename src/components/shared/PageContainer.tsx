import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The gutter and measure for a page rendered in the shell's inset.
 *
 * The inset deliberately supplies no padding of its own, because chat needs to
 * fill it edge to edge. Every other page wraps its body in this instead of
 * hand-rolling a padding value, which is what left the admin and knowledge
 * pages flush against the card edge.
 *
 * `width`:
 * - `wide` (default) — tables, lists and dashboards. Fills the inset up to a
 *   generous cap so a 27" monitor does not stretch a table to 2000px.
 * - `form` — settings and other read-and-edit pages, where a long line length
 *   hurts. Still roomier than a prose column, so the cards do not look
 *   stranded on a wide screen.
 */
export function PageContainer({
  children,
  width = 'wide',
  className,
}: {
  children: ReactNode;
  width?: 'wide' | 'form';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mx-auto w-full min-w-0 space-y-6 p-4 sm:p-6',
        width === 'wide' ? 'max-w-7xl' : 'max-w-4xl',
        className,
      )}
    >
      {children}
    </div>
  );
}
