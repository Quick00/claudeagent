import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';

interface RiseInProps {
  children: ReactNode;
  /** Stagger, in seconds, applied as an animation delay. */
  delay?: number;
  className?: string;
}

/**
 * Entrance animation for a page band: fades in and settles up 8px on
 * mount. `initial`/`animate` stay constant regardless of reduced-motion so
 * the server-rendered and first client-rendered markup always match — only
 * the transition timing (instant vs 300ms) depends on the user's
 * preference, and that's applied client-side only, after mount. Branching
 * the rendered markup on the preference would reintroduce a hydration
 * mismatch between the server render and the first client paint.
 */
export function RiseIn({ children, delay = 0, className }: RiseInProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: prefersReducedMotion ? 0 : 0.3,
        delay: prefersReducedMotion ? 0 : delay,
        ease: 'easeOut',
      }}
    >
      {children}
    </motion.div>
  );
}
