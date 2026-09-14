import type { CSSProperties, ElementType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type StarBorderProps = {
  as?: ElementType;
  className?: string;
  /** Any CSS colour. Defaults to the primary token rather than a literal. */
  color?: string;
  speed?: string;
  /** Border thickness in pixels. */
  thickness?: number;
  children?: ReactNode;
  style?: CSSProperties;
};

/**
 * Adapted from React Bits' StarBorder: two radial-gradient blobs sweeping
 * along the top and bottom edges, clipped to a rounded container.
 *
 * Three deliberate departures from the original:
 *
 * - It is a *wrapper*, not a button skin. The original paints its own
 *   background, border and text colour onto an inner div, which would fight
 *   whatever it wraps. Here the inner layer is transparent so the child keeps
 *   its own styling.
 * - Colours come from tokens, so it follows the theme instead of hardcoding
 *   white on black.
 * - The animation stops under `prefers-reduced-motion`. A perpetual sweep is
 *   exactly the kind of motion that rule exists for.
 *
 * The container clips its children, so a focus ring on the child would be cut
 * off. Put the ring on this element instead (`focus-within:`).
 */
export function StarBorder({
  as: Component = 'div',
  className,
  color = 'var(--primary)',
  speed = '6s',
  thickness = 1,
  children,
  style,
  ...rest
}: StarBorderProps & Record<string, unknown>) {
  const blob = {
    background: `radial-gradient(circle, ${color}, transparent 10%)`,
    animationDuration: speed,
  };

  return (
    <Component
      className={cn('star-border', className)}
      style={{ padding: `${thickness}px`, ...style }}
      {...rest}
    >
      <span aria-hidden className="star-border-sweep-bottom" style={blob} />
      <span aria-hidden className="star-border-sweep-top" style={blob} />
      <span className="star-border-inner">{children}</span>
    </Component>
  );
}
